import { describe, expect, test } from "bun:test";
import {
  createDiscordAuthHandler,
  discordFetch,
  discordWebConfig,
} from "../src/lib/discord/auth.server";
import { unseal } from "@rally-sync/discord/security";

const actor = "123456789012345678";
const secret = "test-discord-session-secret-32-characters";
const config = () => ({
  origin: "https://rally.example.com",
  clientId: "1519475189128233001",
  clientSecret: "private-client-secret",
  sessionSecret: secret,
  allowedUsers: new Set([actor]),
  secure: true,
});
const cookiePair = (header: string) => header.split(";")[0]!;

async function begin(handle: (request: Request) => Promise<Response>) {
  const response = await handle(new Request("https://rally.example.com/api/discord/login"));
  const state = new URL(response.headers.get("location")!).searchParams.get("state")!;
  const cookie = cookiePair(response.headers.getSetCookie()[0]!);
  return { response, state, cookie };
}

describe("Discord OAuth2 routes", () => {
  test("distinguishes blocked outbound networking from invalid OAuth credentials", async () => {
    const handle = createDiscordAuthHandler(config, (url, init) =>
      discordFetch(url, init, async () => {
        throw new TypeError("ConnectionRefused with sensitive transport details");
      }),
    );
    const { state, cookie } = await begin(handle);
    const response = await handle(
      new Request(`https://rally.example.com/api/discord/callback?state=${state}&code=123`, {
        headers: { Cookie: cookie },
      }),
    );
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain("DISCORD_NETWORK_ERROR");
    expect(body).toContain("outbound HTTPS");
    expect(body).not.toContain("DISCORD_CLIENT_SECRET");
    expect(body).not.toContain("sensitive transport details");
  });
  test("reports missing web settings without exposing configured secrets", async () => {
    const sensitiveValue = "sensitive-test-client-secret";
    const handle = createDiscordAuthHandler(() =>
      discordWebConfig({
        APP_ORIGIN: "http://localhost:3000",
        DISCORD_CLIENT_SECRET: sensitiveValue,
      }),
    );
    const response = await handle(new Request("http://localhost:3000/api/discord/login"));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("DISCORD_CONFIGURATION_ERROR");
    expect(body).toContain("DISCORD_SESSION_SECRET");
    expect(body).toContain("DISCORD_ALLOWED_USER_IDS");
    expect(body).not.toContain(sensitiveValue);
  });
  test("accepts local web configuration independently of voice service credentials", () => {
    const settings = discordWebConfig({
      APP_ORIGIN: "http://localhost:3000",
      DISCORD_CLIENT_SECRET: "oauth-client-secret",
      DISCORD_SESSION_SECRET: secret,
      DISCORD_ALLOWED_USER_IDS: actor,
    });
    expect(settings.origin).toBe("http://localhost:3000");
    expect(settings.allowedUsers.has(actor)).toBe(true);
    expect(settings.clientId).toBe("1519475189128233001");
  });
  test("OAuth exchange errors identify the relevant settings without echoing tokens", async () => {
    const sensitiveValue = "sensitive-upstream-error-with-token";
    const handle = createDiscordAuthHandler(config, async () => {
      throw new Error(sensitiveValue);
    });
    const { state, cookie } = await begin(handle);
    const response = await handle(
      new Request(`https://rally.example.com/api/discord/callback?state=${state}&code=123`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("DISCORD_OAUTH_ERROR");
    expect(body).toContain("DISCORD_CLIENT_SECRET");
    expect(body).not.toContain(sensitiveValue);
  });
  test("login sends explicit secure cookies, cache protection and a random OAuth state", async () => {
    const handle = createDiscordAuthHandler(config);
    const { response, state } = await begin(handle);
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://discord.com");
    expect(target.searchParams.get("scope")).toBe("identify");
    expect(target.searchParams.get("redirect_uri")).toBe(`${config().origin}/api/discord/callback`);
    expect((await begin(handle)).state).not.toBe(state);
  });
  test("rejects forged state before exchanging any authorization code", async () => {
    let calls = 0;
    const handle = createDiscordAuthHandler(config, async () => {
      calls++;
      return {};
    });
    const { cookie } = await begin(handle);
    const response = await handle(
      new Request("https://rally.example.com/api/discord/callback?state=forged&code=123", {
        headers: { Cookie: cookie },
      }),
    );
    expect(response.headers.get("location")).toBe(`${config().origin}/?discord=failed`);
    expect(response.headers.getSetCookie()[0]).toContain("Max-Age=0");
    expect(calls).toBe(0);
  });
  test("only signs an allowlisted identity and keeps all access tokens server-side", async () => {
    const calls: string[] = [];
    const token = "discord-access-token-must-stay-private";
    const handle = createDiscordAuthHandler(config, async (url, init) => {
      calls.push(url);
      if (url.endsWith("/token")) {
        expect((init.body as URLSearchParams).get("client_secret")).toBe(config().clientSecret);
        return { access_token: token, refresh_token: "private-refresh-token" };
      }
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
      return { id: actor, username: "commander", global_name: "Commander" };
    });
    const { state, cookie } = await begin(handle);
    const response = await handle(
      new Request(`https://rally.example.com/api/discord/callback?state=${state}&code=123`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(calls).toHaveLength(2);
    const session = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("rally-discord-session="))!;
    const value = cookiePair(session).slice("rally-discord-session=".length);
    const decoded = unseal(value, secret) as { id: string; name: string };
    expect(decoded.id).toBe(actor);
    expect(decoded.name).toBe("Commander");
    expect(JSON.stringify(decoded)).not.toContain("token");
    expect(response.headers.get("location")).toBe(`${config().origin}/`);
  });
  test("denies a non-allowlisted account and clears an existing session", async () => {
    const handle = createDiscordAuthHandler(config, async (url) =>
      url.endsWith("/token")
        ? { access_token: "private-token" }
        : { id: "999999999999999999", username: "outsider" },
    );
    const { state, cookie } = await begin(handle);
    const response = await handle(
      new Request(`https://rally.example.com/api/discord/callback?state=${state}&code=123`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(response.headers.get("location")).toBe(`${config().origin}/?discord=denied`);
    expect(
      response.headers.getSetCookie().find((value) => value.startsWith("rally-discord-session=")),
    ).toContain("Max-Age=0");
  });
});
