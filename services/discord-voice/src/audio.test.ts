import { describe, expect, test } from "bun:test";
import { GuildAudio } from "./audio";
import { encodeSpeech } from "./tts";

describe("voice audio queue", () => {
  test("plays manual speech in order and timed announcements preempt it", async () => {
    const packets = await encodeSpeech(Buffer.alloc(1920 * 10));
    const audio = new GuildAudio();
    try {
      audio.setOnline(true);
      audio.enqueue(packets, "manual first");
      audio.enqueue(packets, "manual second");
      expect(audio.speaking).toBe("manual first");
      expect(audio.queueLength).toBe(1);
      audio.announce(packets, "start rally", "rally", 3, performance.now() + 900);
      expect(audio.speaking).toBe("start rally");
      expect(audio.queueLength).toBe(1);
      audio.announce(packets, "countdown", "rally", 1, performance.now() + 900);
      expect(audio.speaking).toBe("start rally");
      audio.stopRally("rally");
      expect(audio.speaking).toBe("manual second");
      expect(audio.queueLength).toBe(0);
    } finally {
      audio.setOnline(false);
    }
  });
  test("bounds the queue and clears all pending audio when disconnected", async () => {
    const packets = await encodeSpeech(Buffer.alloc(1920));
    const audio = new GuildAudio();
    expect(() => audio.enqueue(packets, "offline")).toThrow("Connect the bot");
    try {
      audio.setOnline(true);
      for (let i = 0; i < 21; i++) audio.enqueue(packets, `message ${i}`);
      expect(audio.queueLength).toBe(20);
      expect(() => audio.enqueue(packets, "overflow")).toThrow("queue is full");
      audio.setOnline(false);
      expect(audio.queueLength).toBe(0);
      expect(audio.speaking).toBeNull();
    } finally {
      audio.setOnline(false);
    }
  });
  test("never plays expired manual messages or late announcements", async () => {
    const packets = await encodeSpeech(Buffer.alloc(1920));
    const audio = new GuildAudio();
    try {
      audio.setOnline(true);
      audio.enqueue(packets, "expired manual", performance.now() - 1);
      audio.announce(packets, "late launch", "rally", 3, performance.now() - 1);
      expect(audio.speaking).toBeNull();
      expect(audio.queueLength).toBe(0);
    } finally {
      audio.setOnline(false);
    }
  });
});
