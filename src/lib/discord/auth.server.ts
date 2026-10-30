import "@tanstack/react-start/server-only";
import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  DISCORD_APPLICATION_ID,
  snowflake,
  type DiscordSession,
  type DiscordUser,
} from "@rally-sync/discord";
import { seal, secureEqual, unseal } from "@rally-sync/discord/security";

const SESSION_COOKIE = "rally-discord-session";
const STATE_COOKIE = "rally-discord-state";
const sessionSchema = z.object({ id: snowflake, name: z.string().max(100), expiresAt: z.number() });
const stateSchema = z.object({ state: z.string(), expiresAt: z.number() });

const webConfigSchema = z.object({
  APP_ORIGIN: z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" ||
          (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
        );
      } catch {
        return false;
      }
    }),
  DISCORD_CLIENT_ID: snowflake.default(DISCORD_APPLICATION_ID),
  DISCORD_CLIENT_SECRET: z.string().trim().min(1),
  DISCORD_SESSION_SECRET: z.string().min(32),
  DISCORD_ALLOWED_USER_IDS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(snowflake).min(1)),
});

class DiscordConfigurationError extends Error {
  constructor(readonly fields: string[]) {
    super("Invalid Discord web configuration");
  }
}

class DiscordApiError extends Error {
  constructor(readonly status: number) {
    super("Discord authentication failed");
  }
}

class DiscordNetworkError extends Error {
  constructor() {
    super("Could not connect to Discord");
  }
}

export function discordWebConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = webConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new DiscordConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  }
  const settings = parsed.data;
  const origin = new URL(settings.APP_ORIGIN);
  return {
    origin: origin.origin,
    clientId: settings.DISCORD_CLIENT_ID,
    clientSecret: settings.DISCORD_CLIENT_SECRET,
    sessionSecret: settings.DISCORD_SESSION_SECRET,
    allowedUsers: new Set(settings.DISCORD_ALLOWED_USER_IDS),
    secure: origin.protocol === "https:",
  };
}

const routeCookie = (name: string, value: string, secure: boolean, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
const requestCookie = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export function readDiscordSession(): DiscordSession {
  setResponseHeader("Cache-Control", "private, no-store");
  let config: ReturnType<typeof discordWebConfig>;
  try {
    config = discordWebConfig();
  } catch {
    return { configured: false, user: null };
  }
  const parsed = sessionSchema.safeParse(unseal(getCookie(SESSION_COOKIE), config.sessionSecret));
  if (!parsed.success || !config.allowedUsers.has(parsed.data.id))
    return { configured: true, user: null };
  return { configured: true, user: { id: parsed.data.id, name: parsed.data.name } };
}

export function requireDiscordUser(): DiscordUser {
  const session = readDiscordSession();
  if (!session.user) throw new Error("Sign in with an authorized Discord account.");
  return session.user;
}

export function logoutDiscord() {
  deleteCookie(SESSION_COOKIE, { path: "/" });
  deleteCookie(STATE_COOKIE, { path: "/" });
}

export async function discordFetch(
  url: string,
  init: RequestInit,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new DiscordNetworkError();
  }
  if (!response.ok) throw new DiscordApiError(response.status);
  return response.json();
}

export function createDiscordAuthHandler(
  getConfig = discordWebConfig,
  apiRequest: (url: string, init: RequestInit) => Promise<unknown> = discordFetch,
) {
  return async (request: Request): Promise<Response> => {
    // Server routes return explicit Responses: attach cookies and cache policy to them.
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    });
    const redirect = (location: string) => {
      headers.set("Location", location);
      return new Response(null, { status: 302, headers });
    };
    const url = new URL(request.url);
    let stage: "configuration" | "login" | "token" | "profile" = "configuration";
    try {
      const config = getConfig();
      stage = "login";
      const redirectUri = `${config.origin}/api/discord/callback`;
      if (url.pathname === "/api/discord/login") {
        const state = randomBytes(32).toString("base64url");
        headers.append(
          "Set-Cookie",
          routeCookie(
            STATE_COOKIE,
            seal({ state, expiresAt: Date.now() + 600_000 }, config.sessionSecret),
            config.secure,
            600,
          ),
        );
        const authorize = new URL("https://discord.com/oauth2/authorize");
        authorize.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: "identify",
          state,
        }).toString();
        return redirect(authorize.href);
      }
      if (url.pathname !== "/api/discord/callback")
        return new Response("Not found", { status: 404, headers });
      const saved = stateSchema.safeParse(
        unseal(requestCookie(request, STATE_COOKIE), config.sessionSecret),
      );
      headers.append("Set-Cookie", routeCookie(STATE_COOKIE, "", config.secure, 0));
      const returnedState = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code");
      if (
        !saved.success ||
        !secureEqual(saved.data.state, returnedState) ||
        !code ||
        code.length > 2048
      ) {
        return redirect(`${config.origin}/?discord=failed`);
      }
      stage = "token";
      const token = z.object({ access_token: z.string() }).parse(
        await apiRequest("https://discord.com/api/v10/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        }),
      );
      stage = "profile";
      const profile = z
        .object({
          id: snowflake,
          username: z.string().max(100),
          global_name: z.string().max(100).nullable().optional(),
        })
        .parse(
          await apiRequest("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bearer ${token.access_token}` },
          }),
        );
      // Access tokens and refresh tokens never enter the cookie or client bundle.
      if (!config.allowedUsers.has(profile.id)) {
        headers.append("Set-Cookie", routeCookie(SESSION_COOKIE, "", config.secure, 0));
        return redirect(`${config.origin}/?discord=denied`);
      }
      headers.append(
        "Set-Cookie",
        routeCookie(
          SESSION_COOKIE,
          seal(
            {
              id: profile.id,
              name: profile.global_name ?? profile.username,
              expiresAt: Date.now() + 8 * 3600_000,
            },
            config.sessionSecret,
          ),
          config.secure,
          8 * 3600,
        ),
      );
      return redirect(`${config.origin}/`);
    } catch (error) {
      const fields = error instanceof DiscordConfigurationError ? error.fields : [];
      // Log only controlled metadata. Exceptions and Discord responses can contain credentials.
      console.error(
        JSON.stringify({
          event: "discord-sign-in-failed",
          stage,
          fields,
          ...(error instanceof DiscordNetworkError ? { failure: "network" } : {}),
          ...(error instanceof DiscordApiError ? { upstreamStatus: error.status } : {}),
        }),
      );
      const message =
        error instanceof DiscordConfigurationError
          ? `Discord sign-in is unavailable. Check these web server settings: ${fields.join(", ")}. Restart the web server or redeploy after saving them.`
          : error instanceof DiscordNetworkError
            ? "The web server could not connect to Discord. Check outbound HTTPS access, firewall or proxy settings, then start sign-in again."
            : stage === "token"
              ? "Discord could not complete OAuth sign-in. Check DISCORD_CLIENT_ID, the OAuth2 DISCORD_CLIENT_SECRET and the registered callback URL, then sign in again."
              : "Discord sign-in is unavailable. Try again shortly and check the server logs.";
      return Response.json(
        {
          error: message,
          code:
            stage === "configuration"
              ? "DISCORD_CONFIGURATION_ERROR"
              : error instanceof DiscordNetworkError
                ? "DISCORD_NETWORK_ERROR"
                : "DISCORD_OAUTH_ERROR",
        },
        { status: 503, headers },
      );
    }
  };
}

export const handleDiscordAuth = createDiscordAuthHandler();
