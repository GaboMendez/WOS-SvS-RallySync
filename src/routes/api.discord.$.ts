import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/discord/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleDiscordAuth } = await import("@/lib/discord/auth.server");
        return handleDiscordAuth(request);
      },
    },
  },
});
