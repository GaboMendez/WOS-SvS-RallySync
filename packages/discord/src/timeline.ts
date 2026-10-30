import { RALLY_HOLD_MS, RALLY_PRE_MS, type RallyPlan } from "./contracts";

export interface Announcement {
  id: string;
  at: number;
  text: string;
}

export function buildTimeline(plan: RallyPlan): { events: Announcement[]; duration: number } {
  const es = plan.language === "es";
  const longest = Math.max(...plan.players.map((player) => player.march));
  const groups = new Map<number, string[]>();
  for (const player of plan.players) {
    const at = (longest - player.march) * 1000;
    groups.set(at, [...(groups.get(at) ?? []), player.name]);
  }
  const events = [...groups]
    .sort(([a], [b]) => a - b)
    .map(([at, names], index): Announcement => {
      const players = names.join(", ");
      const text = index
        ? es
          ? `${names.length === 1 ? "Sigue" : "Siguen"} ${players} en`
          : `Next, ${players} in`
        : es
          ? `${players} ${names.length === 1 ? "inicia" : "inician"} un rally en`
          : `${players} ${names.length === 1 ? "starts" : "start"} a rally in`;
      return { id: `rally-${at}`, at, text };
    });
  return { events, duration: RALLY_HOLD_MS + longest * 1000 };
}

/** Schedule complete countdowns without overlapping earlier players' audio. */
export function scheduleLaunchSpeech(
  events: Announcement[],
  durations: ReadonlyMap<string, { beforeGo: number; total: number }>,
): { events: Announcement[]; leadMs: number } {
  let previousEnd = -Infinity;
  const scheduled = events.map((event) => {
    const duration = durations.get(event.id);
    if (!duration) throw new Error("Missing rally audio duration.");
    const at = Math.max(event.at - duration.beforeGo, previousEnd + 100);
    previousEnd = at + duration.total;
    return { ...event, at };
  });
  return { events: scheduled, leadMs: Math.max(1000, -RALLY_PRE_MS - scheduled[0]!.at + 500) };
}

/** Uses monotonic elapsed time so NTP adjustments cannot move a running rally. */
export class RallyClock {
  private origin = 0;
  private frozen = -RALLY_PRE_MS;
  running = false;
  constructor(private readonly now: () => number = () => performance.now()) {}
  get elapsed(): number {
    return this.running ? this.now() - this.origin : this.frozen;
  }
  start(leadMs = 1000): number {
    this.frozen = -RALLY_PRE_MS - leadMs;
    return this.resume(0);
  }
  pause(): number {
    this.frozen = this.elapsed;
    this.running = false;
    return this.frozen;
  }
  resume(leadMs = 0): number {
    this.origin = this.now() - this.frozen + leadMs;
    this.running = true;
    return this.elapsed;
  }
}
