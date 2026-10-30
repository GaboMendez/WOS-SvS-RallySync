import { useEffect, useRef, useState, useCallback } from "react";
import { cue, unlockAudio } from "@/lib/cues";
import type { ScheduleRow, TimerPhase, TimerState } from "@/lib/rally-data";
import { TagBadge } from "@/components/TagBadge";
import { useDiscordVoice, type TimedReply } from "@/lib/discord/context";
import { RALLY_HOLD_MS, RALLY_PRE_MS } from "@rally-sync/discord";

const HOLD = RALLY_HOLD_MS; // 5-minute countdown after the final launch, before arrival
// const HOLD = 20_000; // 20-seconds countdown after the final launch, before arrival
const PRE = RALLY_PRE_MS;
const NOW_WINDOW = 1500;

function fmtMMSS(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const IDLE_PHASE: TimerPhase = "idle";

export function Countdown({
  rows,
  longest,
  teamName,
  teamKey,
  audio,
  vibrate,
  timerState,
  onTimerStateChange,
}: {
  rows: ScheduleRow[];
  longest: number;
  teamName: string;
  audio: boolean;
  vibrate: boolean;
  teamKey: string;
  timerState: TimerState | null;
  onTimerStateChange: (state: TimerState) => void;
}) {
  const restoredPhase =
    timerState?.phase === "running" && !timerState.startedAt ? "paused" : timerState?.phase;
  const [phase, setPhase] = useState<TimerPhase>(restoredPhase ?? IDLE_PHASE);
  const [elapsed, setElapsed] = useState<number>(timerState?.elapsed ?? -PRE);
  const [confirmReset, setConfirmReset] = useState(false);
  const startRef = useRef(
    timerState?.startedAt
      ? performance.now() - (Date.now() - timerState.startedAt)
      : (timerState?.startTime ?? 0),
  );
  const voice = useDiscordVoice();
  const remote = voice?.status?.rally;
  const ownRemote =
    remote?.teamKey === teamKey && remote.ownerId === voice?.session?.user?.id ? remote : null;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const changeRef = useRef(onTimerStateChange);
  changeRef.current = onTimerStateChange;
  const fired = useRef<Set<string>>(new Set());
  const prefs = useRef({ audio, vibrate });
  prefs.current = { audio, vibrate };

  // The parent keys this component by team; timerState initializes each mount.
  // Notify parent of state changes
  const notifyChange = useCallback((newPhase: TimerPhase, newElapsed: number) => {
    changeRef.current({
      phase: newPhase,
      elapsed: newElapsed,
      startTime: startRef.current,
      startedAt: Date.now() - (performance.now() - startRef.current),
    });
  }, []);

  const applyRemote = useCallback(
    (timed: TimedReply) => {
      const rally = timed.reply.status?.rally;
      if (
        !rally ||
        rally.teamKey !== teamKey ||
        !["running", "paused", "done"].includes(rally.phase)
      )
        return;
      const remotePhase: TimerPhase =
        rally.phase === "running" ? "running" : rally.phase === "paused" ? "paused" : "done";
      const e = rally.elapsed + (remotePhase === "running" ? timed.snapshotAge : 0);
      startRef.current = timed.receivedAt - e;
      setElapsed(e);
      setPhase(remotePhase);
      notifyChange(remotePhase, e);
    },
    [teamKey, notifyChange],
  );

  useEffect(() => {
    if (ownRemote && voice?.timing) applyRemote(voice.timing);
  }, [ownRemote, voice?.timing, applyRemote]);

  const offsets = [...new Set(rows.map((r) => r.offset))].sort((a, b) => a - b);
  const maxOffset = offsets[offsets.length - 1] ?? 0;
  const doneMs = HOLD + longest * 1000;

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      const e = performance.now() - startRef.current;
      setElapsed(e);
      const { audio: a, vibrate: v } = prefs.current;
      for (const t of [-3000, -2000, -1000]) {
        const k = `t${t}`;
        if (e >= t && e < t + 900 && !fired.current.has(k)) {
          fired.current.add(k);
          cue("tick", a, v);
        }
      }
      for (const o of offsets) {
        const k = `o${o}`;
        if (e >= o * 1000 && !fired.current.has(k)) {
          fired.current.add(k);
          if (e < o * 1000 + NOW_WINDOW) cue(o === maxOffset ? "final" : "launch", a, v);
        }
        const k2 = `r${o}`;
        if (e >= o * 1000 + HOLD && !fired.current.has(k2)) {
          fired.current.add(k2);
          if (e < o * 1000 + HOLD + NOW_WINDOW) cue("final", a, v);
        }
      }
      const left = doneMs - e;
      if (left > 0) {
        for (const m of [300, 240, 180, 120, 60]) {
          const k = `m${m}`;
          if (left <= m * 1000 && left > m * 1000 - 900 && !fired.current.has(k)) {
            fired.current.add(k);
            cue("tick", a, v);
          }
        }
        for (const n of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
          const k = `n${n}`;
          if (left <= n * 1000 && left > n * 1000 - 900 && !fired.current.has(k)) {
            fired.current.add(k);
            cue("tick", a, v);
          }
        }
      }
      if (e >= doneMs) {
        cue("final", a, v);
        setPhase("done");
        setElapsed(doneMs);
        notifyChange("done", doneMs);
      }
    }, 40);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const runAction = async (action: () => Promise<void>) => {
    setPending(true);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Discord command failed.");
    } finally {
      setPending(false);
    }
  };
  const start = () =>
    void runAction(async () => {
      unlockAudio();
      fired.current = new Set();
      if (ownRemote?.phase === "ready" && voice) {
        applyRemote(
          await voice.request({ op: "start", guildId: voice.guildId, rallyId: ownRemote.id }),
        );
        return;
      }
      if (ownRemote?.phase === "preparing")
        throw new Error("Speech is still preparing. Try again when it is ready.");
      if (voice?.automatic) {
        if (ownRemote && !["done", "error"].includes(ownRemote.phase)) {
          throw new Error("A rally is already active. Reset it before starting again.");
        }
        const timed = await voice.startRally({
          teamKey,
          teamName,
          players: rows.map(({ player }) => ({
            id: player.id,
            name: player.name,
            march: player.march,
          })),
        });
        applyRemote(timed);
        return;
      }
      if (ownRemote && voice)
        await voice.request({ op: "cancel", guildId: voice.guildId, rallyId: ownRemote.id });
      startRef.current = performance.now() + PRE;
      setElapsed(-PRE);
      setPhase("running");
      notifyChange("running", -PRE);
    });
  const pause = () =>
    void runAction(async () => {
      if (ownRemote && voice) {
        applyRemote(
          await voice.request({ op: "pause", guildId: voice.guildId, rallyId: ownRemote.id }),
        );
        return;
      }
      const e = performance.now() - startRef.current;
      setPhase("paused");
      setElapsed(e);
      notifyChange("paused", e);
    });
  const resume = () =>
    void runAction(async () => {
      unlockAudio();
      if (ownRemote && voice) {
        applyRemote(
          await voice.request({ op: "resume", guildId: voice.guildId, rallyId: ownRemote.id }),
        );
        return;
      }
      startRef.current = performance.now() - elapsed;
      setPhase("running");
      notifyChange("running", elapsed);
    });
  const reset = () =>
    void runAction(async () => {
      if (ownRemote && voice)
        await voice.request({ op: "cancel", guildId: voice.guildId, rallyId: ownRemote.id });
      setPhase("idle");
      setElapsed(-PRE);
      fired.current = new Set();
      setConfirmReset(false);
      notifyChange("idle", -PRE);
    });

  if (rows.length < 2) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
        Add at least <b className="text-foreground">2 players</b> to this team to calculate a
        synchronized launch.
      </div>
    );
  }

  const status = (o: number, march: number) => {
    if (phase === "idle" || phase === "ready") return "upcoming";
    const ms = o * 1000;
    if (elapsed >= ms + HOLD + march * 1000) return "arrived";
    if (elapsed >= ms + HOLD) return "launched";
    if (elapsed >= ms) return "now";
    return "upcoming";
  };

  const inPre = elapsed < 0;
  const nextOffset = offsets.find((o) => o * 1000 > elapsed);
  const nowOffset = offsets.find((o) => elapsed >= o * 1000 && elapsed < o * 1000 + NOW_WINDOW);
  const nextRows = nextOffset !== undefined ? rows.filter((r) => r.offset === nextOffset) : [];
  const nowRows = nowOffset !== undefined ? rows.filter((r) => r.offset === nowOffset) : [];
  const active = phase === "running" || phase === "paused";
  const firstOffset = offsets[0] ?? 0;
  const firstPlayerElapsed = elapsed - firstOffset * 1000;
  const allMarching = firstPlayerElapsed > HOLD;

  let big = "";
  let label = "";
  if (inPre) {
    big = elapsed < -PRE ? "READY" : String(Math.ceil(-elapsed / 1000));
    label = "Get ready";
  } else if (nowRows.length && !nextRows.length) {
    big = "GO";
    label = "Final launch";
  } else if (nextRows.length) {
    big = ((nextOffset! * 1000 - elapsed) / 1000).toFixed(1);
    label = "Next launch in";
  } else if (allMarching) {
    big = fmtMMSS(longest * 1000 - (firstPlayerElapsed - HOLD));
    label = "All arrived in";
  } else {
    big = fmtMMSS(HOLD - (elapsed - maxOffset * 1000));
    label = "Last rally ending";
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {actionError}
        </p>
      )}
      <fieldset disabled={pending || voice?.preparing} className="space-y-4 disabled:opacity-60">
        {phase === "idle" && (
          <div className="rounded-xl border bg-card p-4">
            <p className="font-display text-sm uppercase tracking-widest text-muted-foreground">
              Ready check
            </p>
            <p className="mt-1 text-lg">
              <b>{teamName}</b> · {rows.length} players · first launch{" "}
              <b className="text-accent">
                {rows
                  .filter((r) => r.first)
                  .map((r) => r.player.name)
                  .join(", ")}
              </b>{" "}
              · arrival at <b className="digits text-primary">{longest}s</b>
            </p>
            <button
              onClick={start}
              className="mt-4 w-full rounded-lg bg-accent py-4 font-display text-2xl font-bold uppercase tracking-wider text-accent-foreground active:scale-[0.98]"
            >
              {pending || voice?.preparing ? "Preparing voice…" : "Start countdown"}
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              3-2-1 ready check, START for each player, then{" "}
              <b className="digits text-foreground">5:00</b> rally countdown.
            </p>
          </div>
        )}

        {phase !== "idle" && (
          <div
            className={`rounded-xl border bg-card p-5 text-center ${nowRows.length || inPre ? "glow-accent" : ""}`}
          >
            <p className="font-display text-sm uppercase tracking-widest text-muted-foreground">
              {phase === "done" ? "Rallies arrived" : label}
            </p>
            <p
              className={`digits text-[clamp(4rem,22vw,8rem)] font-extrabold leading-none ${nowRows.length ? "text-accent" : "text-primary"}`}
            >
              {phase === "done" ? "✓" : big}
            </p>
            {nowRows.length > 0 && phase !== "done" && (
              <p className="mt-2 font-display text-3xl font-bold uppercase text-accent">
                START now: {nowRows.map((r) => r.player.name).join(" + ")}
              </p>
            )}
            {!inPre && nextRows.length > 0 && (
              <p className="mt-2 text-lg">
                Next: <b>{nextRows.map((r) => r.player.name).join(" + ")}</b>{" "}
                <span className="digits text-muted-foreground">
                  ({nextRows[0]?.player.march}s march)
                </span>
              </p>
            )}
            {inPre && (
              <p className="mt-2 text-lg">
                First:{" "}
                <b>
                  {rows
                    .filter((r) => r.first)
                    .map((r) => r.player.name)
                    .join(" + ")}
                </b>
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {ownRemote ? "Synchronized with Discord voice." : "Timer runs on this device only."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {phase === "running" && (
                <button
                  onClick={pause}
                  className="rounded-lg bg-secondary py-3 font-display text-xl font-bold uppercase"
                >
                  Pause
                </button>
              )}
              {phase === "paused" && (
                <button
                  onClick={resume}
                  className="rounded-lg bg-primary py-3 font-display text-xl font-bold uppercase text-primary-foreground"
                >
                  Resume
                </button>
              )}
              {phase === "done" && (
                <button
                  onClick={start}
                  className="rounded-lg bg-primary py-3 font-display text-xl font-bold uppercase text-primary-foreground"
                >
                  Restart
                </button>
              )}
              {confirmReset ? (
                <button
                  onClick={reset}
                  className="rounded-lg bg-destructive py-3 font-display text-xl font-bold uppercase text-destructive-foreground"
                >
                  Confirm reset
                </button>
              ) : (
                <button
                  onClick={() => (active ? setConfirmReset(true) : reset())}
                  className="rounded-lg border py-3 font-display text-xl font-bold uppercase"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        )}
      </fieldset>

      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_3.5rem_4rem_4rem_5rem] gap-2 bg-secondary px-3 py-2 font-display text-xs uppercase tracking-wider text-muted-foreground">
          <span>#</span>
          <span>Player</span>
          <span className="text-right">March</span>
          <span className="text-right">Delay</span>
          <span className="text-right">Rally</span>
          <span className="text-right">March</span>
          <span className="text-right">Status</span>
        </div>
        {rows.map((r) => {
          const s = status(r.offset, r.player.march);
          const playerElapsed = elapsed - r.offset * 1000;
          const rallyLeft = playerElapsed > 0 && playerElapsed < HOLD ? HOLD - playerElapsed : 0;
          const marchLeft =
            playerElapsed > HOLD ? r.player.march * 1000 - (playerElapsed - HOLD) : 0;
          const isRallying = playerElapsed > 0 && playerElapsed < HOLD;
          const isMarching = playerElapsed > HOLD && playerElapsed < HOLD + r.player.march * 1000;
          return (
            <div
              key={r.player.id}
              className={`grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_3.5rem_4rem_4rem_5rem] items-center gap-2 border-t px-3 py-2.5 ${s === "now" ? "bg-accent text-accent-foreground" : s === "launched" ? "bg-primary/20" : s === "arrived" ? "opacity-50" : ""}`}
            >
              <span className="digits font-bold">{r.order}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{r.player.name}</span>
                <span className="flex items-center gap-1.5">
                  <TagBadge tag={r.player.tag} />
                  {r.first && (
                    <span className="rounded bg-accent px-1.5 text-[10px] font-bold uppercase text-accent-foreground">
                      1st
                    </span>
                  )}
                </span>
              </span>
              <span className="digits text-right">{r.player.march}s</span>
              <span className="digits text-right font-bold">+{r.offset}s</span>
              <span className="text-right digits text-sm font-bold">
                {isRallying ? fmtMMSS(rallyLeft) : "-"}
              </span>
              <span className="text-right digits text-sm font-bold">
                {isMarching ? fmtMMSS(marchLeft) : "-"}
              </span>
              <span className="text-right font-display text-sm font-bold uppercase">
                {s === "now"
                  ? "Started"
                  : s === "launched"
                    ? "Launched"
                    : s === "arrived"
                      ? "Arrived"
                      : "Upcoming"}
              </span>
            </div>
          );
        })}
        <div className="border-t bg-secondary px-3 py-2 text-sm text-muted-foreground">
          After each player starts, a <b className="digits text-primary">5:00</b> rally countdown
          runs before they arrive.
        </div>
      </div>
    </div>
  );
}
