import { type RallyPlan, type RallySnapshot } from "@rally-sync/discord";
import {
  buildTimeline,
  scheduleLaunchSpeech,
  RallyClock,
  type Announcement,
} from "@rally-sync/discord/timeline";
import type { RallyAudio } from "./audio";
import type { SpeechAudio, SpeechProvider } from "./tts";
import { VoiceError } from "./errors";

interface Run {
  plan: RallyPlan;
  ownerId: string;
  phase: RallySnapshot["phase"];
  clock: RallyClock;
  events: Announcement[];
  duration: number;
  clips: Map<string, SpeechAudio>;
  fired: Set<string>;
  error: string | null;
  expiresAt: number;
  leadMs: number;
}

// One 20 ms Opus silence packet, used to keep the countdown on one-second beats.
const SILENCE_PACKET = Buffer.from([0xf8, 0xff, 0xfe]);
const FRAMES_PER_SECOND = 50;

function countdownAudio(intro: SpeechAudio, numbers: SpeechAudio[], go: SpeechAudio) {
  const audio = [...intro];
  for (const number of numbers) {
    audio.push(...number);
    for (let frame = number.length; frame < FRAMES_PER_SECOND; frame++) {
      audio.push(SILENCE_PACKET);
    }
  }
  const beforeGo = audio.length * 20;
  audio.push(...go);
  return { audio, beforeGo, total: audio.length * 20 };
}

/** One authoritative run per guild. Preparation finishes before the clock starts. */
export class GuildRallies {
  private run: Run | null = null;
  constructor(
    private readonly speech: SpeechProvider,
    private readonly audio: RallyAudio,
    private readonly monotonic: () => number = () => performance.now(),
  ) {}

  snapshot(wallNow = Date.now()): RallySnapshot | null {
    const run = this.run;
    if (!run) return null;
    const elapsed = run.clock.elapsed;
    return {
      id: run.plan.id,
      teamKey: run.plan.teamKey,
      teamName: run.plan.teamName,
      ownerId: run.ownerId,
      phase: run.phase,
      elapsed,
      startAt: run.phase === "running" ? wallNow - elapsed : null,
      error: run.error,
    };
  }

  prepare(plan: RallyPlan, actor: string) {
    if (this.run?.plan.id === plan.id) {
      if (this.run.ownerId !== actor || JSON.stringify(this.run.plan) !== JSON.stringify(plan)) {
        throw new VoiceError("That rally ID is already in use.", 409);
      }
      return;
    }
    if (this.run && !["done", "error"].includes(this.run.phase)) {
      throw new VoiceError(
        "Another rally is active in this server. Cancel it before starting a new one.",
        409,
      );
    }
    const { events, duration } = buildTimeline(plan);
    const run: Run = {
      plan,
      ownerId: actor,
      phase: "preparing",
      clock: new RallyClock(this.monotonic),
      events,
      duration,
      clips: new Map(),
      fired: new Set(),
      error: null,
      expiresAt: this.monotonic() + 120_000,
      leadMs: 1000,
    };
    this.run = run;
    void this.prepareAudio(run);
  }

  private async prepareAudio(run: Run) {
    let index = 0;
    const durations = new Map<string, { beforeGo: number; total: number }>();
    try {
      const [three, two, one, go] = await Promise.all(
        ["3", "2", "1", run.plan.language === "es" ? "¡Ya!" : "Go!"].map((text) =>
          this.speech.get(text, run.plan.language),
        ),
      );
      const numbers = [three!, two!, one!];
      const prepareNext = async () => {
        while (this.run === run && run.phase === "preparing") {
          const event = run.events[index++];
          if (!event) break;
          const intro = await this.speech.get(event.text, run.plan.language);
          if (this.run !== run || run.phase !== "preparing") return;
          const clip = countdownAudio(intro, numbers, go!);
          run.clips.set(event.id, clip.audio);
          durations.set(event.id, { beforeGo: clip.beforeGo, total: clip.total });
        }
      };
      await Promise.all([prepareNext(), prepareNext(), prepareNext()]);
      if (this.run === run && run.phase === "preparing") {
        const scheduled = scheduleLaunchSpeech(run.events, durations);
        run.events = scheduled.events;
        run.leadMs = scheduled.leadMs;
        run.phase = "ready";
        run.expiresAt = this.monotonic() + 120_000;
      }
    } catch (error) {
      if (this.run === run && run.phase === "preparing") {
        run.phase = "error";
        run.error = error instanceof VoiceError ? error.message : "Could not prepare rally audio.";
        run.clips.clear();
      }
    }
  }

  private requireRun(id: string, actor: string, ownerOnly = true): Run {
    if (!this.run || this.run.plan.id !== id)
      throw new VoiceError("This rally is no longer active.", 409);
    if (ownerOnly && this.run.ownerId !== actor)
      throw new VoiceError("Only the rally owner can change its timer.", 403);
    return this.run;
  }

  start(id: string, actor: string) {
    const run = this.requireRun(id, actor);
    if (run.phase === "running") return; // Safe retry after a lost response.
    if (run.phase !== "ready")
      throw new VoiceError("Rally audio is still preparing or has failed.", 409);
    if (!this.audio.available()) throw new VoiceError("The voice connection is not ready.", 409);
    run.clock.start(run.leadMs);
    run.phase = "running";
  }
  pause(id: string, actor: string) {
    const run = this.requireRun(id, actor);
    if (run.phase === "paused") return;
    if (run.phase !== "running") throw new VoiceError("The rally is not running.", 409);
    run.clock.pause();
    run.phase = "paused";
    run.expiresAt = this.monotonic() + 3600_000;
    this.audio.stopRally(id);
  }
  resume(id: string, actor: string) {
    const run = this.requireRun(id, actor);
    if (run.phase === "running") return;
    if (run.phase !== "paused") throw new VoiceError("The rally is not paused.", 409);
    if (!this.audio.available()) throw new VoiceError("The voice connection is not ready.", 409);
    run.clock.resume();
    run.phase = "running";
  }
  cancel(id: string, actor: string) {
    if (!this.run) return;
    // Any explicitly authorized guild member can emergency-stop a rally.
    this.requireRun(id, actor, false);
    this.clear();
  }
  clear() {
    if (this.run) this.audio.stopRally(this.run.plan.id);
    this.run = null;
  }

  tick() {
    const run = this.run;
    if (!run) return;
    if (["preparing", "ready", "paused"].includes(run.phase) && this.monotonic() > run.expiresAt) {
      run.phase = "error";
      run.error = "The rally expired. Start a new countdown.";
      run.clips.clear();
      this.audio.stopRally(run.plan.id);
    }
    if (run.phase !== "running") return;
    // Keep due instructions pending while voice reconnects instead of losing them.
    if (!this.audio.available()) return;
    const elapsed = run.clock.elapsed;
    for (const event of run.events) {
      if (event.at > elapsed || run.fired.has(event.id)) continue;
      run.fired.add(event.id);
      const audio = run.clips.get(event.id);
      if (!audio) continue;
      this.audio.announce(audio, event.text, run.plan.id);
    }
    if (elapsed >= run.duration && run.fired.size === run.events.length) {
      run.clock.pause();
      run.phase = "done";
      run.clips.clear();
    }
  }
}
