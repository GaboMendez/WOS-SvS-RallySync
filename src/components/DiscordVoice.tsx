import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ChannelSummary,
  DiscordSession,
  GuildSummary,
  RallyPlan,
  VoiceLanguage,
  VoiceRequest,
  VoiceStatus,
} from "@rally-sync/discord";
import { discordControl, getDiscordSession, logoutDiscord } from "@/lib/discord/functions";
import { DiscordVoiceContext as Context, type TimedReply } from "@/lib/discord/context";

export function DiscordVoiceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DiscordSession | null>(null);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [guildId, setGuildId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [language, setLanguage] = useState<VoiceLanguage>("en");
  const [automatic, setAutomatic] = useState(false);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [timing, setTiming] = useState<TimedReply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [text, setText] = useState("");
  const guildRef = useRef(guildId);
  guildRef.current = guildId;
  const mounted = useRef(true);
  const lastSnapshot = useRef({ guildId: "", serverNow: 0 });

  const request = useCallback(async (input: VoiceRequest): Promise<TimedReply> => {
    const sentAt = performance.now();
    const result = await discordControl({ data: input });
    const receivedAt = performance.now();
    if (!result.ok) throw new Error(result.error);
    const roundTrip = receivedAt - sentAt;
    const timed = {
      reply: result.reply,
      receivedAt,
      roundTrip,
      snapshotAge: Math.max(0, roundTrip - result.executionMs) / 2 + (result.reply.relayAgeMs ?? 0),
    };
    if (
      mounted.current &&
      "guildId" in input &&
      input.guildId === guildRef.current &&
      result.reply.status &&
      (lastSnapshot.current.guildId !== input.guildId ||
        result.reply.serverNow >= lastSnapshot.current.serverNow)
    ) {
      lastSnapshot.current = { guildId: input.guildId, serverNow: result.reply.serverNow };
      setStatus(result.reply.status);
      setTiming(timed);
    }
    return timed;
  }, []);

  const refreshGuilds = useCallback(async () => {
    const { reply } = await request({ op: "guilds" });
    if (mounted.current) setGuilds(reply.guilds ?? []);
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    const outcome = new URLSearchParams(window.location.search).get("discord");
    if (outcome === "denied")
      setError("This Discord account is not authorized to control the bot.");
    if (outcome === "failed")
      setError("Discord sign-in expired or was cancelled. Try signing in again.");
    if (outcome) {
      const url = new URL(window.location.href);
      url.searchParams.delete("discord");
      window.history.replaceState(null, "", url);
    }
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("rally-discord-preferences") ?? "null",
      );
      if (saved && typeof saved === "object") {
        if ("guildId" in saved && typeof saved.guildId === "string") setGuildId(saved.guildId);
        if ("language" in saved && (saved.language === "en" || saved.language === "es"))
          setLanguage(saved.language);
      }
    } catch {
      /* optional preferences */
    }
    getDiscordSession()
      .then((value) => {
        if (mounted.current) setSession(value);
      })
      .catch(() => {
        if (mounted.current) setError("Could not load your Discord session. Refresh the page.");
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    void refreshGuilds().catch((error: unknown) => {
      if (mounted.current) setError(message(error));
    });
  }, [session, refreshGuilds]);

  useEffect(() => {
    try {
      localStorage.setItem("rally-discord-preferences", JSON.stringify({ guildId, language }));
    } catch {
      /* optional */
    }
  }, [guildId, language]);

  useEffect(() => {
    setChannels([]);
    setChannelId("");
    setStatus(null);
    setTiming(null);
    if (!session?.user || !guildId) return;
    let active = true;
    request({ op: "channels", guildId })
      .then(({ reply }) => {
        if (active) setChannels(reply.channels ?? []);
      })
      .catch((error: unknown) => {
        if (active) setError(message(error));
      });
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await request({ op: "status", guildId });
      } catch (error) {
        if (active) setError(message(error));
      }
      if (active)
        timer = setTimeout(() => {
          void poll();
        }, 2000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [guildId, session, request]);

  const startRally = useCallback(
    async (plan: Omit<RallyPlan, "id" | "language">) => {
      if (!guildId) throw new Error("Select a Discord server first.");
      const id = crypto.randomUUID();
      setPreparing(true);
      try {
        let timed = await request({ op: "prepare", guildId, plan: { ...plan, id, language } });
        const deadline = performance.now() + 100_000;
        while (timed.reply.status?.rally?.phase === "preparing") {
          if (!mounted.current || performance.now() > deadline)
            throw new Error("Audio preparation timed out. Try again.");
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          timed = await request({ op: "status", guildId });
        }
        if (!mounted.current) throw new Error("The countdown was cancelled.");
        const rally = timed.reply.status?.rally;
        if (rally?.id !== id || rally.phase !== "ready")
          throw new Error(rally?.error ?? "The countdown was cancelled.");
        return await request({ op: "start", guildId, rallyId: id });
      } catch (error) {
        // Resolve a lost start response before reporting failure or leaving an orphan run.
        try {
          const current = await request({ op: "status", guildId });
          if (current.reply.status?.rally?.id === id) {
            if (current.reply.status.rally.phase === "running") return current;
            await request({ op: "cancel", guildId, rallyId: id });
          }
        } catch {
          /* status polling will show recovery when the service returns */
        }
        throw error;
      } finally {
        if (mounted.current) setPreparing(false);
      }
    },
    [guildId, language, request],
  );

  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  };
  const activeRally =
    status?.rally && !["done", "error"].includes(status.rally.phase) ? status.rally : null;
  const connected = status?.connection === "ready";
  const selectionLocked = busy || preparing || Boolean(activeRally);

  return (
    <Context.Provider
      value={{
        session,
        guildId,
        language,
        automatic,
        status,
        timing,
        request,
        startRally,
        preparing,
      }}
    >
      <div className="contents">
        <section className="mb-4 rounded-xl border bg-card p-3" aria-label="Discord voice control">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold uppercase">3496_BOT · Discord voice</h2>
            {session?.user && (
              <span className="text-xs text-muted-foreground">
                {session.user.name}
                <button
                  className="ml-3 underline"
                  disabled={busy || preparing}
                  onClick={() =>
                    void perform(async () => {
                      await logoutDiscord();
                      setSession({ configured: true, user: null });
                      setAutomatic(false);
                      setStatus(null);
                    })
                  }
                >
                  Sign out
                </button>
              </span>
            )}
          </div>
          {!session && (
            <p className="mt-2 text-sm text-muted-foreground">Loading Discord access…</p>
          )}
          {session && !session.configured && (
            <p className="mt-2 text-sm text-muted-foreground">
              Discord voice is not configured. The rally timer is available below.
            </p>
          )}
          {session?.configured && !session.user && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <a
                href="/api/discord/login"
                className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                Sign in with Discord
              </a>
              <p className="text-xs text-muted-foreground">
                Bot control is limited to authorized accounts.
              </p>
            </div>
          )}
          {session?.user && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-muted-foreground">
                  Server
                  <select
                    aria-label="Discord server"
                    value={guildId}
                    disabled={selectionLocked}
                    onChange={(event) => {
                      setGuildId(event.target.value);
                      setAutomatic(false);
                      setError("");
                    }}
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Select a server</option>
                    {guilds.map((guild) => (
                      <option key={guild.id} value={guild.id}>
                        {guild.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Voice channel
                  <select
                    aria-label="Discord voice channel"
                    value={channelId || status?.channelId || ""}
                    disabled={selectionLocked || !guildId}
                    onChange={(event) => setChannelId(event.target.value)}
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Select a voice channel</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Speech language
                  <select
                    aria-label="Speech language"
                    value={language}
                    disabled={selectionLocked}
                    onChange={(event) => setLanguage(event.target.value as VoiceLanguage)}
                    className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground"
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={selectionLocked || !(channelId || status?.channelId) || !guildId}
                  onClick={() =>
                    void perform(() =>
                      request({
                        op: "connect",
                        guildId,
                        channelId: channelId || status!.channelId!,
                      }),
                    )
                  }
                  className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  Connect
                </button>
                <button
                  disabled={busy || preparing || !status?.channelId}
                  onClick={() =>
                    void perform(async () => {
                      await request({ op: "disconnect", guildId });
                      setAutomatic(false);
                    })
                  }
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-40"
                >
                  Disconnect
                </button>
                <span
                  role="status"
                  className={`text-xs ${connected ? "text-accent" : "text-muted-foreground"}`}
                >
                  {status ? connectionLabel(status) : "Disconnected"} · Queue:{" "}
                  {status?.queueLength ?? 0}
                </span>
                <button
                  disabled={busy || preparing}
                  onClick={() => void perform(refreshGuilds)}
                  className="ml-auto text-xs underline disabled:opacity-40"
                >
                  Refresh servers
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={automatic}
                  disabled={(!connected && !automatic) || preparing}
                  onChange={(event) => setAutomatic(event.target.checked)}
                />
                Announce rally starts, marches and arrival countdowns for new countdowns
              </label>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const submitted = text.trim();
                  if (submitted)
                    void perform(async () => {
                      await request({
                        op: "speak",
                        guildId,
                        id: crypto.randomUUID(),
                        text: submitted,
                        language,
                      });
                      setText("");
                    });
                }}
              >
                <input
                  aria-label="Manual voice instruction"
                  placeholder={
                    language === "es" ? "Instrucción para el rally…" : "Rally instruction…"
                  }
                  maxLength={500}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                />
                <button
                  disabled={!connected || busy || !text.trim()}
                  className="rounded-md bg-secondary px-3 py-2 text-sm font-semibold disabled:opacity-40"
                >
                  Speak
                </button>
                <button
                  type="button"
                  disabled={busy || !connected}
                  onClick={() => void perform(() => request({ op: "clearQueue", guildId }))}
                  className="rounded-md border px-3 py-2 text-xs disabled:opacity-40"
                >
                  Clear queue
                </button>
              </form>
              {status?.speaking && (
                <p className="text-xs text-muted-foreground" aria-live="off">
                  Speaking: {status.speaking}
                </p>
              )}
              {activeRally && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary p-2 text-sm">
                  <span>
                    {activeRally.teamName} ·{" "}
                    {activeRally.phase === "preparing" ? "Preparing speech…" : activeRally.phase}
                  </span>
                  <button
                    disabled={busy}
                    className="font-semibold text-destructive underline disabled:opacity-40"
                    onClick={() =>
                      void perform(() =>
                        request({ op: "cancel", guildId, rallyId: activeRally.id }),
                      )
                    }
                  >
                    Stop rally announcements
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Automatic announcements keep running when you leave this page. Manual speech may be
                interrupted by timed rally instructions.
              </p>
            </div>
          )}
          {(error || status?.error || status?.rally?.error) && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error || status?.error || status?.rally?.error}
            </p>
          )}
        </section>
        {children}
      </div>
    </Context.Provider>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Discord request failed.";
}
function connectionLabel(status: VoiceStatus): string {
  if (status.gateway === "reconnecting") return "Gateway reconnecting";
  return {
    disconnected: "Disconnected",
    connecting: "Connecting…",
    ready: "Connected",
    reconnecting: "Reconnecting…",
    error: "Connection error",
  }[status.connection];
}
