import { createServerFn } from "@tanstack/react-start";
import { voiceRequestSchema } from "@rally-sync/discord";

export const getDiscordSession = createServerFn({ method: "GET" }).handler(async () => {
  const { readDiscordSession } = await import("./auth.server");
  return readDiscordSession();
});

export const logoutDiscord = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutDiscord: logout } = await import("./auth.server");
  logout();
  return { ok: true };
});

export const discordControl = createServerFn({ method: "POST" })
  .validator(voiceRequestSchema)
  .handler(async ({ data }) => {
    const startedAt = performance.now();
    try {
      const { callVoiceService } = await import("./bridge.server");
      const reply = await callVoiceService(data);
      return { ok: true as const, reply, executionMs: performance.now() - startedAt };
    } catch (error) {
      const message =
        error instanceof Error && !("issues" in error)
          ? error.message
          : "The Discord integration is not configured correctly.";
      return { ok: false as const, error: message };
    }
  });
