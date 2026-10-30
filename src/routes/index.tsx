import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  TABS,
  computeSchedule,
  initialState,
  uid,
  type AppState,
  type Player,
  type TabId,
  type TabState,
} from "@/lib/rally-data";
import { canVibrate } from "@/lib/cues";
import { Countdown } from "@/components/Countdown";
import { TagBadge } from "@/components/TagBadge";
import { DiscordVoiceProvider } from "@/components/DiscordVoice";
import { useDiscordVoice } from "@/lib/discord/context";

// Asset imports
import petsActiveNotExpedition from "@/assets/pets-active-not-expedition-facility.png";
import notPetsActiveNotExpedition from "@/assets/not-pets-active-not-expedition-facility.png";
import notPetsActiveWithExpedition from "@/assets/not-pets-active-with-expedition-facility.png";
import petsActiveWithExpedition from "@/assets/pets-active-with-expedition-facility.png";

const REFERENCES = [
  {
    src: petsActiveNotExpedition,
    alt: "Pets + No Exp",
    desc: "Your march time when pets are active and no expedition facility",
  },
  {
    src: notPetsActiveNotExpedition,
    alt: "No Pets + No Exp",
    desc: "Your march time when no pets and no expedition facility",
  },
  {
    src: notPetsActiveWithExpedition,
    alt: "No Pets + Exp",
    desc: "Your march time when no pets but have expedition facility",
  },
  {
    src: petsActiveWithExpedition,
    alt: "Pets + Exp",
    desc: "Your march time when pets are active and have expedition facility",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rally Sync — Whiteout Survival SFC & SvS Timer" },
      {
        name: "description",
        content:
          "Coordinate synchronized rallies for Sunfire Castle and SvS: march-time offsets, launch order and live countdown.",
      },
      { property: "og:title", content: "Rally Sync — Whiteout Survival SFC & SvS Timer" },
      {
        property: "og:description",
        content: "Coordinate synchronized rallies so every march lands at the same moment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const KEY = "rally-sync-v1";

function Index() {
  const [state, setState] = useState<AppState>(initialState);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<TabId>("timing");
  const [audio, setAudio] = useState(true);
  const [vibrate, setVibrate] = useState(true);
  const [vibOk, setVibOk] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) {
        const p = JSON.parse(s);
        if (p.state) setState(p.state);
        if (p.tab) setTab(p.tab);
        if (typeof p.audio === "boolean") setAudio(p.audio);
        if (typeof p.vibrate === "boolean") setVibrate(p.vibrate);
      }
    } catch {
      /* ignore */
    }
    setVibOk(canVibrate());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify({ state, tab, audio, vibrate }));
  }, [state, tab, audio, vibrate, loaded]);

  const ts = state[tab];
  const update = (fn: (t: TabState) => TabState) => setState((s) => ({ ...s, [tab]: fn(s[tab]) }));

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-3 pb-16 pt-4 sm:px-6">
      <header className="mb-4 grid gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl font-extrabold uppercase sm:text-4xl">
            Rally<span className="text-primary">Sync</span>
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            SFC & SvS coordination · manual tool, not connected to the game
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <Toggle on={audio} onClick={() => setAudio(!audio)} label="Sound" />
          <Toggle
            on={vibrate && vibOk}
            disabled={!vibOk}
            onClick={() => setVibrate(!vibrate)}
            label={vibOk ? "Vibe" : "No vibe"}
          />

          <a
            href="https://github.com/GaboMendez/WOS-SvS-RallySync"
            target="_blank"
            rel="noreferrer"
            className="ml-2 flex items-center justify-center gap-2 px-2 py-2 border-t border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors sm:border-none"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3.5"
              aria-hidden="true"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
              <path d="M9 18c-4.51 2-5-2-7-2"></path>
            </svg>
            GitHub repository
          </a>
        </div>
      </header>

      <DiscordVoiceProvider>
        <nav className="sticky top-0 z-10 -mx-3 mb-4 flex gap-1 overflow-x-auto bg-background/90 px-3 py-2 backdrop-blur scrollbar-hide sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0 sm:overflow-x-visible">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-lg px-3 py-2.5 font-display text-xs font-bold uppercase tracking-wide sm:py-3 sm:text-lg ${tab === t.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <TabView
          key={tab}
          ts={ts}
          update={update}
          audio={audio}
          vibrate={vibrate && vibOk}
          tabId={tab}
        />
      </DiscordVoiceProvider>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 font-display text-xs font-bold uppercase ${on ? "border-primary text-primary" : "text-muted-foreground"} disabled:opacity-40`}
    >
      {label} {on ? "on" : "off"}
    </button>
  );
}

function TabView({
  ts,
  update,
  audio,
  vibrate,
  tabId,
}: {
  ts: TabState;
  update: (fn: (t: TabState) => TabState) => void;
  audio: boolean;
  vibrate: boolean;
  tabId: TabId;
}) {
  const voice = useDiscordVoice();
  const team = ts.teams.find((t) => t.id === ts.selectedTeamId) ?? null;
  const members = useMemo(
    () =>
      team
        ? (team.playerIds
            .map((id) => ts.players.find((p) => p.id === id))
            .filter(Boolean) as Player[])
        : [],
    [team, ts.players],
  );
  const { rows, longest } = useMemo(() => computeSchedule(members), [members]);
  const rally = voice?.status?.rally;
  const planLocked = Boolean(
    rally && !["done", "error"].includes(rally.phase) && rally.teamKey.startsWith(`${tabId}:`),
  );
  if (tabId === "references") return <ReferencesTab />;

  const setTeam = (id: string, fn: (ids: string[]) => string[]) =>
    update((t) => ({
      ...t,
      teams: t.teams.map((tm) => (tm.id === id ? { ...tm, playerIds: fn(tm.playerIds) } : tm)),
    }));

  const createTeam = () => {
    const id = uid();
    update((t) => ({
      ...t,
      teams: [...t.teams, { id, name: `Team ${t.teams.length + 1}`, playerIds: [] }],
      selectedTeamId: id,
    }));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        {/* Teams */}
        <section className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold uppercase">Teams</h2>
            <button
              onClick={createTeam}
              className="rounded-md bg-primary px-3 py-1.5 font-display text-sm font-bold uppercase text-primary-foreground"
            >
              + New team
            </button>
          </div>
          {ts.teams.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No teams yet. Create one to start coordinating.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {ts.teams.map((tm) => (
              <button
                key={tm.id}
                onClick={() => update((t) => ({ ...t, selectedTeamId: tm.id }))}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${tm.id === team?.id ? "border-primary bg-primary/15 text-primary" : ""}`}
              >
                {tm.name}{" "}
                <span className="digits text-muted-foreground">({tm.playerIds.length})</span>
              </button>
            ))}
          </div>
          {team && (
            <fieldset
              disabled={planLocked}
              className="mt-3 space-y-2 border-t pt-3 disabled:opacity-60"
            >
              <div className="flex gap-2">
                <input
                  value={team.name}
                  onChange={(e) =>
                    update((t) => ({
                      ...t,
                      teams: t.teams.map((x) =>
                        x.id === team.id ? { ...x, name: e.target.value } : x,
                      ),
                    }))
                  }
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-semibold"
                  aria-label="Team name"
                />
                <button
                  onClick={() => {
                    if (confirm(`Delete ${team.name}?`))
                      update((t) => ({
                        ...t,
                        teams: t.teams.filter((x) => x.id !== team.id),
                        selectedTeamId: null,
                      }));
                  }}
                  className="rounded-md border border-destructive px-3 text-sm font-bold text-destructive"
                >
                  Delete
                </button>
              </div>
              {members.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Tap players in the roster below to add them.
                </p>
              )}
              {members.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1.5"
                >
                  <span className="digits w-5 text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <TagBadge tag={p.tag} />
                  <span className="digits w-10 text-right">{p.march}s</span>
                  <IconBtn
                    disabled={i === 0}
                    onClick={() => setTeam(team.id, (ids) => swap(ids, i, i - 1))}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    disabled={i === members.length - 1}
                    onClick={() => setTeam(team.id, (ids) => swap(ids, i, i + 1))}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn onClick={() => setTeam(team.id, (ids) => ids.filter((x) => x !== p.id))}>
                    ✕
                  </IconBtn>
                </div>
              ))}
            </fieldset>
          )}
        </section>

        <fieldset disabled={planLocked} className="disabled:opacity-60">
          <Roster ts={ts} update={update} team={team} setTeam={setTeam} />
        </fieldset>
        {planLocked && (
          <p className="text-xs text-muted-foreground">
            The launch plan is locked while Discord announcements are active.
          </p>
        )}
      </div>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold uppercase">
          Launch plan {team && <span className="text-primary">· {team.name}</span>}
        </h2>
        {team ? (
          <Countdown
            key={team.id}
            rows={rows}
            longest={longest}
            teamName={team.name}
            teamKey={`${tabId}:${team.id}`}
            audio={audio}
            vibrate={vibrate}
            timerState={(ts.timerStates ?? {})[team.id] ?? null}
            onTimerStateChange={(newState) =>
              update((t) => ({
                ...t,
                timerStates: { ...(t.timerStates ?? {}), [team.id]: newState },
              }))
            }
          />
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
            Select or create a team.
          </div>
        )}
      </section>
    </div>
  );
}

function ReferencesTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-display text-lg font-bold uppercase">March Time by Square</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Find your square around the rally target. Match your setup: pets active? Alliance has
          expedition facility?
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {REFERENCES.map((ref) => (
          <div key={ref.alt} className="rounded-xl border bg-card p-3">
            <img src={ref.src} alt={ref.alt} className="w-full rounded-lg border" />
            <p className="mt-2 text-sm font-medium">{ref.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function swap(a: string[], i: number, j: number) {
  const b = [...a];
  const x = b[i]!;
  b[i] = b[j]!;
  b[j] = x;
  return b;
}

function IconBtn({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className="grid h-8 w-8 shrink-0 place-items-center rounded border text-sm disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Roster({
  ts,
  update,
  team,
  setTeam,
}: {
  ts: TabState;
  update: (fn: (t: TabState) => TabState) => void;
  team: TabState["teams"][number] | null;
  setTeam: (id: string, fn: (ids: string[]) => string[]) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [n, setN] = useState({ name: "", march: "", tag: "" });
  const [allianceFilter, setAllianceFilter] = useState<string>("all");

  const alliances = useMemo(
    () => ["all", ...new Set(ts.players.map((p) => p.tag).filter(Boolean))].sort(),
    [ts.players],
  );
  const filteredPlayers = useMemo(
    () =>
      allianceFilter === "all" ? ts.players : ts.players.filter((p) => p.tag === allianceFilter),
    [ts.players, allianceFilter],
  );
  const editP = (id: string, patch: Partial<Player>) =>
    update((t) => ({
      ...t,
      players: t.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const add = () => {
    const m = Number(n.march);
    if (!n.name.trim() || !(m > 0)) return;
    update((t) => ({
      ...t,
      players: [
        ...t.players,
        { id: uid(), name: n.name.trim(), march: m, tag: n.tag.trim().toUpperCase() },
      ],
    }));
    setN({ name: "", march: "", tag: "" });
  };
  const remove = (p: Player) => {
    if (!confirm(`Remove ${p.name} from this tab?`)) return;
    update((t) => ({
      ...t,
      players: t.players.filter((x) => x.id !== p.id),
      teams: t.teams.map((tm) => ({ ...tm, playerIds: tm.playerIds.filter((x) => x !== p.id) })),
    }));
  };

  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold uppercase">Roster</h2>
        <button
          onClick={() => setEdit(!edit)}
          className={`rounded-md border px-3 py-1.5 font-display text-sm font-bold uppercase ${edit ? "border-primary text-primary" : ""}`}
        >
          {edit ? "Done" : "Edit"}
        </button>
      </div>
      {alliances.length > 1 && !edit && (
        <div className="mb-2">
          <select
            value={allianceFilter}
            onChange={(e) => setAllianceFilter(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {alliances.map((a) => (
              <option key={a} value={a}>
                {a === "all" ? "All Alliances" : a}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        {filteredPlayers.map((p) => {
          const inTeam = team?.playerIds.includes(p.id);
          if (edit) {
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                <input
                  value={p.name}
                  onChange={(e) => editP(p.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5"
                  aria-label="Name"
                />
                <input
                  value={p.tag}
                  onChange={(e) => editP(p.id, { tag: e.target.value.toUpperCase() })}
                  className="w-14 rounded border bg-background px-2 py-1.5 font-mono text-sm"
                  aria-label="Tag"
                />
                <input
                  type="number"
                  min={1}
                  value={p.march}
                  onChange={(e) => editP(p.id, { march: Math.max(0, Number(e.target.value)) })}
                  className="digits w-16 rounded border bg-background px-2 py-1.5"
                  aria-label="March seconds"
                />
                <IconBtn onClick={() => remove(p)}>✕</IconBtn>
              </div>
            );
          }
          return (
            <button
              key={p.id}
              disabled={!team}
              onClick={() =>
                team &&
                setTeam(team.id, (ids) => (inTeam ? ids.filter((x) => x !== p.id) : [...ids, p.id]))
              }
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left ${inTeam ? "border-primary bg-primary/15" : ""} disabled:cursor-default`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-xs ${inTeam ? "border-primary bg-primary text-primary-foreground" : ""}`}
              >
                {inTeam ? "✓" : ""}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <TagBadge tag={p.tag} />
              <span className="digits w-10 text-right font-bold">{p.march}s</span>
            </button>
          );
        })}
      </div>
      {edit && (
        <div className="mt-3 flex items-center gap-1.5 border-t pt-3">
          <input
            placeholder="New player"
            value={n.name}
            onChange={(e) => setN({ ...n, name: e.target.value })}
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5"
          />
          <input
            placeholder="Tag"
            value={n.tag}
            onChange={(e) => setN({ ...n, tag: e.target.value })}
            className="w-14 rounded border bg-background px-2 py-1.5 font-mono text-sm"
          />
          <input
            placeholder="Sec"
            type="number"
            value={n.march}
            onChange={(e) => setN({ ...n, march: e.target.value })}
            className="w-16 rounded border bg-background px-2 py-1.5"
          />
          <button
            onClick={add}
            className="rounded bg-primary px-3 py-1.5 font-bold text-primary-foreground"
          >
            Add
          </button>
        </div>
      )}
      {!team && !edit && (
        <p className="mt-2 text-xs text-muted-foreground">Select a team to add players.</p>
      )}
    </section>
  );
}
