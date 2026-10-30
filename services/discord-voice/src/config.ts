import { z } from "zod";
import { DISCORD_APPLICATION_ID, snowflake } from "@rally-sync/discord";

const ids = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .pipe(z.array(snowflake));
const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(20),
  DISCORD_CLIENT_ID: snowflake.default(DISCORD_APPLICATION_ID),
  DISCORD_ALLOWED_USER_IDS: ids.refine((values) => values.length > 0),
  DISCORD_ALLOWED_GUILD_IDS: ids.default(""),
  VOICE_SHARED_SECRET: z.string().min(32),
  AZURE_SPEECH_KEY: z.string().min(1),
  AZURE_SPEECH_REGION: z.string().regex(/^[a-z0-9-]+$/),
  AZURE_SPEECH_VOICE_EN: z
    .string()
    .regex(/^en-[\w-]+Neural$/)
    .default("en-US-JennyNeural"),
  AZURE_SPEECH_VOICE_ES: z
    .string()
    .regex(/^es-[\w-]+Neural$/)
    .default("es-ES-ElviraNeural"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export function readConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Never log Zod inputs: they can include credentials.
    throw new Error(
      `Invalid voice service settings: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  return parsed.data;
}
export type VoiceConfig = ReturnType<typeof readConfig>;
