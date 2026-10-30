import { describe, expect, test } from "bun:test";
import { signRequest } from "@rally-sync/discord/security";
import { createControlHandler, type ControlTarget } from "../services/discord-voice/src/http";
import { VoiceError } from "../services/discord-voice/src/errors";
import { escapeXml } from "../services/discord-voice/src/tts";
import { readConfig } from "../services/discord-voice/src/config";

const actor = "123456789012345678";
const secret = "voice-test-shared-secret-32-characters";
function fixture() {
  const calls: unknown[] = [];
  const target: ControlTarget = {
    ready: () => true,
    control: async (input, user) => {
      calls.push([input, user]);
      return { serverNow: Date.now(), guilds: [] };
    },
  };
  const handle = createControlHandler(target, secret, new Set([actor]));
  const request = (input: unknown, overrides: RequestInit = {}) => {
    const body = JSON.stringify(input);
    return new Request("http://voice/v1/control", {
      method: "POST",
      headers: signRequest(secret, actor, body),
      body,
      ...overrides,
    });
  };
  return { calls, target, handle, request };
}

describe("private voice HTTP API", () => {
  test("only dispatches authenticated, valid commands and preserves actor identity", async () => {
    const f = fixture();
    const response = await f.handle(f.request({ op: "guilds" }));
    expect(response.status).toBe(200);
    expect(f.calls).toEqual([[{ op: "guilds" }, actor]]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  test("rejects unsigned commands, schema injection and replay", async () => {
    const f = fixture();
    expect(
      (
        await f.handle(
          f.request({ op: "guilds" }, { headers: { "content-type": "application/json" } }),
        )
      ).status,
    ).toBe(401);
    expect((await f.handle(f.request({ op: "guilds", actor: "999999999999999999" }))).status).toBe(
      400,
    );
    const original = f.request({ op: "guilds" });
    const replay = original.clone();
    expect((await f.handle(original)).status).toBe(200);
    expect((await f.handle(replay)).status).toBe(401);
    expect(f.calls).toHaveLength(1);
  });
  test("rejects large payloads, unexpected paths and GET control requests", async () => {
    const f = fixture();
    expect((await f.handle(f.request({ op: "guilds", padding: "x".repeat(16_384) }))).status).toBe(
      413,
    );
    expect((await f.handle(new Request("http://voice/v1/control"))).status).toBe(405);
    expect((await f.handle(new Request("http://voice/private"))).status).toBe(404);
    expect(f.calls).toHaveLength(0);
  });
  test("health exposes readiness without any server details", async () => {
    const f = fixture();
    const response = await f.handle(new Request("http://voice/healthz"));
    expect(await response.json()).toEqual({ ok: true });
    f.target.ready = () => false;
    expect((await f.handle(new Request("http://voice/healthz"))).status).toBe(503);
  });
  test("returns safe permission errors", async () => {
    const f = fixture();
    f.target.control = async () => {
      throw new VoiceError("Access denied.", 403);
    };
    const response = await f.handle(f.request({ op: "guilds" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Access denied." });
  });
  test("limits authenticated request rates", async () => {
    const f = fixture();
    for (let i = 0; i < 180; i++)
      expect((await f.handle(f.request({ op: "guilds" }))).status).toBe(200);
    expect((await f.handle(f.request({ op: "guilds" }))).status).toBe(429);
    expect(f.calls).toHaveLength(180);
  });
});

test("TTS text cannot inject SSML or XML", () => {
  expect(escapeXml('<voice name="bad">A & B\'s</voice>')).toBe(
    "&lt;voice name=&quot;bad&quot;&gt;A &amp; B&apos;s&lt;/voice&gt;",
  );
});

test("invalid settings fail closed without including secrets in errors", () => {
  const privateToken = "sensitive-token";
  try {
    readConfig({ DISCORD_BOT_TOKEN: privateToken });
    throw new Error("Unexpected valid config");
  } catch (error) {
    expect((error as Error).message).toContain("DISCORD_ALLOWED_USER_IDS");
    expect((error as Error).message).not.toContain(privateToken);
  }
});
