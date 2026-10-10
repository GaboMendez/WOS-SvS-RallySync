import { useEffect, useRef, useState } from "react";
import { cue, unlockAudio } from "@/lib/cues";
import type { ScheduleRow } from "@/lib/rally-data";
import { TagBadge } from "./TagBadge";

type Phase = "idle" | "ready" | "running" | "paused" | "done";
const HOLD = 300_000; // 5-minute countdown after the final launch, before arrival
const PRE = 3000;
const NOW_WINDOW = 1500;

function fmtMMSS(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Countdown({ rows, longest, teamName, audio, vibrate }: {
  rows: ScheduleRow[]; longest: number; teamName: string; audio: boolean; vibrate: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(-PRE);
  const [confirmReset, setConfirmReset] = useState(false);
  const startRef = useRef(0);
  const fired = useRef<Set<string>>(new Set());
  const prefs = useRef({ audio, vibrate });
  prefs.current = { audio, vibrate };

  const offsets = [...new Set(rows.map((r) => r.offset))].sort((a, b) => a - b);
  const maxOffset = offsets[offsets.length - 1] ?? 0;
  const doneMs = maxOffset * 1000 + HOLD;

  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      const e = performance.now() - startRef.current;
      setElapsed(e);
      const { audio: a, vibrate: v } = prefs.current;
      for (const t of [-3000, -2000, -1000]) {
        const k = `t${t}`;
        if (e >= t && e < t + 900 && !fired.current.has(k)) { fired.current.add(k); cue("tick", a, v); }
      }
      for (const o of offsets) {
        const k = `o${o}`;
        if (e >= o * 1000 && !fired.current.has(k)) {
          fired.current.add(k);
          if (e < o * 1000 + NOW_WINDOW) cue(o === maxOffset ? "final" : "launch", a, v);
        }
      }
      const left = doneMs - e;
      if (left > 0) {
        for (const m of [300, 240, 180, 120, 60]) {
          const k = `m${m}`;
          if (left <= m * 1000 && left > m * 1000 - 900 && !fired.current.has(k)) { fired.current.add(k); cue("tick", a, v); }
        }
        for (const n of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) {
          const k = `n${n}`;
          if (left <= n * 1000 && left > n * 1000 - 900 && !fired.current.has(k)) { fired.current.add(k); cue("tick", a, v); }
        }
      }
      if (e >= doneMs) {
        cue("final", a, v);
        setPhase("done");
        setElapsed(doneMs);
      }
    }, 40);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => {
    unlockAudio();
    fired.current = new Set();
    startRef.current = performance.now() + PRE;
    setElapsed(-PRE);
    setPhase("running");
  };
  const pause = () => setPhase("paused");
  const resume = () => { unlockAudio(); startRef.current = performance.now() - elapsed; setPhase("running"); };
  const reset = () => { setPhase("idle"); setElapsed(-PRE); fired.current = new Set(); setConfirmReset(false); };

  if (rows.length < 2) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
        Add at least <b className="text-foreground">2 players</b> to this team to calculate a synchronized launch.
      </div>
    );
  }

  const status = (o: number) => {
    if (phase === "idle" || phase === "ready") return "upcoming";
    const ms = o * 1000;
    if (elapsed >= ms + NOW_WINDOW) return "launched";
    if (elapsed >= ms) return "now";
    return "upcoming";
  };

  const inPre = elapsed < 0;
  const nextOffset = offsets.find((o) => o * 1000 > elapsed) ;
  const nowOffset = offsets.find((o) => elapsed >= o * 1000 && elapsed < o * 1000 + NOW_WINDOW);
  const nextRows = nextOffset !== undefined ? rows.filter((r) => r.offset === nextOffset) : [];
  const nowRows = nowOffset !== undefined ? rows.filter((r) => r.offset === nowOffset) : [];
  const active = phase === "running" || phase === "paused";

  let big = "";
  let label = "";
  if (inPre) { big = String(Math.ceil(-elapsed / 1000)); label = "Get ready"; }
  else if (nowRows.length && !nextRows.length) { big = "GO"; label = "Final launch"; }
  else if (nextRows.length) { big = ((nextOffset! * 1000 - elapsed) / 1000).toFixed(1); label = "Next launch in"; }
  else { big = fmtMMSS(doneMs - elapsed); label = "Arrival in"; }

  return (
    <div className="space-y-4">
      {phase === "idle" && (
        <div className="rounded-xl border bg-card p-4">
          <p className="font-display text-sm uppercase tracking-widest text-muted-foreground">Ready check</p>
          <p className="mt-1 text-lg">
            <b>{teamName}</b> · {rows.length} players · first launch{" "}
            <b className="text-accent">{rows.filter((r) => r.first).map((r) => r.player.name).join(", ")}</b> · arrival at{" "}
            <b className="digits text-primary">{longest}s</b>
          </p>
          <button onClick={start} className="mt-4 w-full rounded-lg bg-accent py-4 font-display text-2xl font-bold uppercase tracking-wider text-accent-foreground active:scale-[0.98]">
            Start countdown
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">3-2-1 ready check, launches in order, then a <b className="digits text-foreground">5:00</b> countdown to arrival.</p>
        </div>
      )}

      {phase !== "idle" && (
        <div className={`rounded-xl border bg-card p-5 text-center ${nowRows.length || inPre ? "glow-accent" : ""}`}>
          <p className="font-display text-sm uppercase tracking-widest text-muted-foreground">{phase === "done" ? "Rallies arriving" : label}</p>
          <p className={`digits text-[clamp(4rem,22vw,8rem)] font-extrabold leading-none ${nowRows.length ? "text-accent" : "text-primary"}`}>
            {phase === "done" ? "✓" : big}
          </p>
          {nowRows.length > 0 && phase !== "done" && (
            <p className="mt-2 font-display text-3xl font-bold uppercase text-accent">
              Launch now: {nowRows.map((r) => r.player.name).join(" + ")}
            </p>
          )}
          {!inPre && nextRows.length > 0 && (
            <p className="mt-2 text-lg">
              Next: <b>{nextRows.map((r) => r.player.name).join(" + ")}</b>{" "}
              <span className="digits text-muted-foreground">({nextRows[0]?.player.march}s march)</span>
            </p>
          )}
          {inPre && (
            <p className="mt-2 text-lg">First: <b>{rows.filter((r) => r.first).map((r) => r.player.name).join(" + ")}</b></p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Timer runs on this device only.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {phase === "running" && <button onClick={pause} className="rounded-lg bg-secondary py-3 font-display text-xl font-bold uppercase">Pause</button>}
            {phase === "paused" && <button onClick={resume} className="rounded-lg bg-primary py-3 font-display text-xl font-bold uppercase text-primary-foreground">Resume</button>}
            {phase === "done" && <button onClick={start} className="rounded-lg bg-primary py-3 font-display text-xl font-bold uppercase text-primary-foreground">Restart</button>}
            {confirmReset ? (
              <button onClick={reset} className="rounded-lg bg-destructive py-3 font-display text-xl font-bold uppercase text-destructive-foreground">Confirm reset</button>
            ) : (
              <button onClick={() => (active ? setConfirmReset(true) : reset())} className="rounded-lg border py-3 font-display text-xl font-bold uppercase">Reset</button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_3.5rem_5.5rem] gap-2 bg-secondary px-3 py-2 font-display text-xs uppercase tracking-wider text-muted-foreground">
          <span>#</span><span>Player</span><span className="text-right">March</span><span className="text-right">Delay</span><span className="text-right">Status</span>
        </div>
        {rows.map((r) => {
          const s = status(r.offset);
          return (
            <div key={r.player.id} className={`grid grid-cols-[2rem_minmax(0,1fr)_3.5rem_3.5rem_5.5rem] items-center gap-2 border-t px-3 py-2.5 ${s === "now" ? "bg-accent text-accent-foreground" : s === "launched" ? "opacity-50" : ""}`}>
              <span className="digits font-bold">{r.order}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{r.player.name}</span>
                <TagBadge tag={r.player.tag} />
                {r.first && <span className="shrink-0 rounded bg-accent px-1.5 text-[10px] font-bold uppercase text-accent-foreground">1st</span>}
              </span>
              <span className="digits text-right">{r.player.march}s</span>
              <span className="digits text-right font-bold">+{r.offset}s</span>
              <span className="text-right font-display text-sm font-bold uppercase">{s === "now" ? "Launch!" : s === "launched" ? "Launched" : "Upcoming"}</span>
            </div>
          );
        })}
        <div className="border-t bg-secondary px-3 py-2 text-sm text-muted-foreground">
          After the final launch, a <b className="digits text-primary">5:00</b> countdown runs before the rallies arrive.
        </div>
      </div>
    </div>
  );
}
