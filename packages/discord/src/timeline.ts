import { RALLY_HOLD_MS, RALLY_PRE_MS, type RallyPlan } from "./contracts";

export interface Announcement {
  id: string;
  at: number;
  text: string;
  priority: number;
}

export function buildTimeline(plan: RallyPlan): { events: Announcement[]; duration: number } {
  const es = plan.language === "es";
  const longest = Math.max(...plan.players.map((p) => p.march));
  const duration = RALLY_HOLD_MS + longest * 1000;
  const groups = new Map<number, string[]>();
  for (const player of plan.players) {
    const offset = (longest - player.march) * 1000;
    groups.set(offset, [...(groups.get(offset) ?? []), player.name]);
  }
  const events: Announcement[] = [3, 2, 1].map((n) => ({
    id: `pre-${n}`,
    at: -n * 1000,
    text: String(n),
    priority: 1,
  }));
  for (const [at, names] of groups) {
    events.push({
      id: `rally-${at}`,
      at,
      text: es ? `${names.join(", ")}, inicien rally.` : `${names.join(", ")}, start rally.`,
      priority: 3,
    });
    events.push({
      id: `march-${at}`,
      at: at + RALLY_HOLD_MS,
      text: es ? `${names.join(", ")}, marchando.` : `${names.join(", ")}, marching.`,
      priority: 3,
    });
  }
  for (const seconds of [300, 240, 180, 120, 60]) {
    // The first start is more useful than a simultaneous five minute warning.
    const at = duration - seconds * 1000;
    events.push({
      id: `arrival-${seconds}`,
      at,
      text: es ? `Llegada en ${seconds / 60} minutos.` : `Arrival in ${seconds / 60} minutes.`,
      priority: 0,
    });
  }
  for (let n = 10; n >= 1; n--) {
    events.push({ id: `final-${n}`, at: duration - n * 1000, text: String(n), priority: 1 });
  }
  events.push({
    id: "arrived",
    at: duration,
    text: es ? "Todos los rallies llegaron." : "All rallies arrived.",
    priority: 4,
  });
  // Never speak a countdown or warning over a launch at the same instant.
  const byTime = new Map<number, Announcement>();
  for (const event of events) {
    if (event.priority >= (byTime.get(event.at)?.priority ?? -1)) byTime.set(event.at, event);
  }
  return { events: [...byTime.values()].sort((a, b) => a.at - b.at), duration };
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
