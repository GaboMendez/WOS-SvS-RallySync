import { describe, expect, test } from "bun:test";
import {
  MAX_AUDIO_LATENESS_MS,
  RALLY_HOLD_MS,
  rallyPlanSchema,
  type RallyPlan,
} from "@rally-sync/discord";
import { buildTimeline, RallyClock } from "@rally-sync/discord/timeline";
import { computeSchedule, initialState } from "../src/lib/rally-data";
import { GuildRallies } from "../services/discord-voice/src/rallies";
import type { RallyAudio } from "../services/discord-voice/src/audio";
import type { SpeechProvider } from "../services/discord-voice/src/tts";

const actor = "123456789012345678";
const plan = (): RallyPlan => ({
  id: crypto.randomUUID(),
  teamKey: "timing:alpha",
  teamName: "Alpha",
  language: "en",
  players: [
    { id: "a", name: "Beast", march: 48 },
    { id: "b", name: "Candie", march: 36 },
  ],
});

function fixture(speech: SpeechProvider = { get: async () => [Buffer.from("audio")] }) {
  let now = 0;
  let online = true;
  const heard: string[] = [];
  const stopped: string[] = [];
  const audio: RallyAudio = {
    announce: (_, text) => {
      heard.push(text);
    },
    stopRally: (id) => {
      stopped.push(id);
    },
    available: () => online,
  };
  const rallies = new GuildRallies(speech, audio, () => now);
  return {
    rallies,
    heard,
    stopped,
    at: (time: number) => {
      now = time;
      rallies.tick();
    },
    online: (value: boolean) => {
      online = value;
    },
  };
}
async function ready(rallies: GuildRallies) {
  for (let i = 0; i < 100; i++) {
    if (rallies.snapshot()?.phase !== "preparing") return;
    await Promise.resolve();
  }
  throw new Error("Preparation did not finish");
}

describe("rally timeline", () => {
  test("matches all existing march offsets and the five minute hold", () => {
    for (const tab of ["timing", "pets1", "pets2"] as const) {
      const players = initialState()[tab].players;
      const { rows, longest } = computeSchedule(players);
      const { events, duration } = buildTimeline({ ...plan(), players });
      expect(duration).toBe(RALLY_HOLD_MS + longest * 1000);
      for (const row of rows) {
        expect(events.find((event) => event.id === `rally-${row.offset * 1000}`)?.at).toBe(
          row.offset * 1000,
        );
        expect(events.find((event) => event.id === `march-${row.offset * 1000}`)?.at).toBe(
          RALLY_HOLD_MS + row.offset * 1000,
        );
      }
    }
  });
  test("groups simultaneous launches and provides English and Spanish", () => {
    const input = plan();
    input.players[1]!.march = 48;
    for (const language of ["en", "es"] as const) {
      const events = buildTimeline({ ...input, language }).events;
      const launch = events.filter((event) => event.id.startsWith("rally-"));
      expect(launch).toHaveLength(1);
      expect(launch[0]!.text).toContain("Beast, Candie");
      expect(launch[0]!.text).toContain(language === "es" ? "inicien rally" : "start rally");
    }
  });
  test("a launch wins over an arrival warning at the same instant", () => {
    const input = plan();
    input.players[1]!.march = 5;
    const events = buildTimeline(input).events;
    expect(events.filter((event) => event.at === 343_000)).toHaveLength(1);
    expect(events.find((event) => event.at === 343_000)!.priority).toBe(3);
  });
  test("validates limits and rejects duplicate player IDs", () => {
    const input = plan();
    expect(rallyPlanSchema.safeParse(input).success).toBe(true);
    input.players[1]!.id = input.players[0]!.id;
    expect(rallyPlanSchema.safeParse(input).success).toBe(false);
    expect(
      rallyPlanSchema.safeParse({ ...plan(), players: [{ id: "a", name: "A", march: Infinity }] })
        .success,
    ).toBe(false);
  });
});

test("the clock uses elapsed monotonic time and freezes exactly on pause", () => {
  let now = 100;
  const clock = new RallyClock(() => now);
  clock.start();
  expect(clock.elapsed).toBe(-4000);
  now += 5000;
  expect(clock.pause()).toBe(1000);
  now += 100_000;
  expect(clock.elapsed).toBe(1000);
  clock.resume();
  now += 250;
  expect(clock.elapsed).toBe(1250);
});

describe("authoritative rally scheduler", () => {
  test("prepares before starting and schedules every launch without browser ticks", async () => {
    const f = fixture();
    const input = plan();
    f.rallies.prepare(input, actor);
    expect(() => f.rallies.start(input.id, actor)).toThrow("still preparing");
    await ready(f.rallies);
    expect(f.rallies.snapshot()?.phase).toBe("ready");
    f.rallies.start(input.id, actor);
    f.at(1000);
    expect(f.heard).toEqual(["3"]);
    f.at(2000);
    f.at(3000);
    f.at(4000);
    f.at(16_000);
    expect(f.heard).toContain("Beast, start rally.");
    expect(f.heard).toContain("Candie, start rally.");
    f.at(304_000);
    expect(f.heard).toContain("Beast, marching.");
    f.at(316_000);
    expect(f.heard).toContain("Candie, marching.");
    f.at(352_000);
    expect(f.heard.at(-1)).toBe("All rallies arrived.");
    expect(f.rallies.snapshot()?.phase).toBe("done");
  });
  test("drops stale announcements and never replays them after reconnection", async () => {
    const f = fixture();
    const input = plan();
    f.rallies.prepare(input, actor);
    await ready(f.rallies);
    f.rallies.start(input.id, actor);
    f.at(4000 + MAX_AUDIO_LATENESS_MS + 1);
    expect(f.heard).toHaveLength(0);
    f.online(false);
    f.at(16_000);
    f.online(true);
    f.at(16_020);
    expect(f.heard).toHaveLength(0);
  });
  test("pause and resume preserve fired events and do not duplicate countdowns", async () => {
    const f = fixture();
    const input = plan();
    f.rallies.prepare(input, actor);
    await ready(f.rallies);
    f.rallies.start(input.id, actor);
    f.at(1000);
    f.rallies.pause(input.id, actor);
    f.at(10_000);
    expect(f.rallies.snapshot()?.elapsed).toBe(-3000);
    f.rallies.resume(input.id, actor);
    f.at(10_020);
    expect(f.heard).toEqual(["3"]);
    f.at(11_000);
    expect(f.heard).toEqual(["3", "2"]);
  });
  test("preparation cancellation cannot resurrect a run", async () => {
    let resolve!: (audio: Buffer[]) => void;
    const pending = new Promise<Buffer[]>((done) => {
      resolve = done;
    });
    const f = fixture({ get: () => pending });
    const input = plan();
    f.rallies.prepare(input, actor);
    f.rallies.cancel(input.id, actor);
    resolve([Buffer.from("audio")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.rallies.snapshot()).toBeNull();
  });
  test("enforces ownership and run conflicts, with idempotent starts", async () => {
    const f = fixture();
    const input = plan();
    f.rallies.prepare(input, actor);
    f.rallies.prepare(input, actor);
    expect(() => f.rallies.prepare(plan(), actor)).toThrow("Another rally");
    await ready(f.rallies);
    expect(() => f.rallies.start(input.id, "999999999999999999")).toThrow("Only the rally owner");
    f.rallies.start(input.id, actor);
    f.at(1500);
    f.rallies.start(input.id, actor);
    expect(f.rallies.snapshot()?.elapsed).toBe(-2500);
    f.rallies.cancel(input.id, "999999999999999999");
    expect(f.rallies.snapshot()).toBeNull();
  });
  test("reports synthesis errors and expires abandoned preparations", async () => {
    const f = fixture({
      get: async () => {
        throw new Error("provider failure");
      },
    });
    f.rallies.prepare(plan(), actor);
    await ready(f.rallies);
    expect(f.rallies.snapshot()?.phase).toBe("error");
    const next = fixture();
    next.rallies.prepare(plan(), actor);
    await ready(next.rallies);
    next.at(120_001);
    expect(next.rallies.snapshot()?.phase).toBe("error");
  });
});
