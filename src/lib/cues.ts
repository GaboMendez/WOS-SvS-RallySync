let ctx: AudioContext | null = null;
function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
export function unlockAudio() { ac(); }

function tone(freq: number, dur: number, delay = 0, type: OscillatorType = "square") {
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}

export const canVibrate = () => typeof navigator !== "undefined" && "vibrate" in navigator;
function vib(p: number | number[], on: boolean) { if (on && canVibrate()) try { navigator.vibrate(p); } catch { /* noop */ } }

export type CueKind = "tick" | "launch" | "final";
export function cue(kind: CueKind, audio: boolean, vibrate: boolean) {
  if (kind === "tick") { if (audio) tone(660, 0.12, 0, "sine"); vib(60, vibrate); }
  if (kind === "launch") { if (audio) { tone(880, 0.12); tone(1175, 0.18, 0.13); } vib([120, 60, 120], vibrate); }
  if (kind === "final") { if (audio) { tone(880, 0.1); tone(1175, 0.1, 0.11); tone(1568, 0.35, 0.22); } vib([200, 80, 200, 80, 400], vibrate); }
}
