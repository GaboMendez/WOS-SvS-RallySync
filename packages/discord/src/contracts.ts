import { z } from "zod";

export const DISCORD_APPLICATION_ID = "1519475189128233001";
export const RALLY_HOLD_MS = 300_000;
export const RALLY_PRE_MS = 3_000;
export const MAX_AUDIO_LATENESS_MS = 900;

export const snowflake = z.string().regex(/^\d{17,20}$/);
export const language = z.enum(["en", "es"]);
export type VoiceLanguage = z.infer<typeof language>;

export const rallyPlanSchema = z
  .object({
    id: z.string().uuid(),
    teamKey: z.string().min(1).max(100),
    teamName: z.string().trim().min(1).max(80),
    language,
    players: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            name: z.string().trim().min(1).max(60),
            march: z.number().int().min(1).max(600),
          })
          .strict(),
      )
      .min(2)
      .max(30),
  })
  .strict()
  .refine((plan) => new Set(plan.players.map((p) => p.id)).size === plan.players.length, {
    message: "Player IDs must be unique",
  });
export type RallyPlan = z.infer<typeof rallyPlanSchema>;

const guildId = { guildId: snowflake };
const rallyId = { ...guildId, rallyId: z.string().uuid() };
export const voiceRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("guilds") }).strict(),
  z.object({ op: z.literal("channels"), ...guildId }).strict(),
  z.object({ op: z.literal("status"), ...guildId }).strict(),
  z.object({ op: z.literal("connect"), ...guildId, channelId: snowflake }).strict(),
  z.object({ op: z.literal("disconnect"), ...guildId }).strict(),
  z.object({ op: z.literal("clearQueue"), ...guildId }).strict(),
  z
    .object({
      op: z.literal("speak"),
      ...guildId,
      id: z.string().uuid(),
      text: z.string().trim().min(1).max(500),
      language,
    })
    .strict(),
  z.object({ op: z.literal("prepare"), ...guildId, plan: rallyPlanSchema }).strict(),
  z.object({ op: z.literal("start"), ...rallyId }).strict(),
  z.object({ op: z.literal("pause"), ...rallyId }).strict(),
  z.object({ op: z.literal("resume"), ...rallyId }).strict(),
  z.object({ op: z.literal("cancel"), ...rallyId }).strict(),
]);
export type VoiceRequest = z.infer<typeof voiceRequestSchema>;

export interface DiscordUser {
  id: string;
  name: string;
}
export interface DiscordSession {
  configured: boolean;
  user: DiscordUser | null;
}
export interface GuildSummary {
  id: string;
  name: string;
}
export interface ChannelSummary {
  id: string;
  name: string;
}
export interface RallySnapshot {
  id: string;
  teamKey: string;
  teamName: string;
  ownerId: string;
  phase: "preparing" | "ready" | "running" | "paused" | "done" | "error";
  elapsed: number;
  startAt: number | null;
  error: string | null;
}
export interface VoiceStatus {
  gateway: "ready" | "reconnecting";
  connection: "disconnected" | "connecting" | "ready" | "reconnecting" | "error";
  channelId: string | null;
  queueLength: number;
  speaking: string | null;
  error: string | null;
  rally: RallySnapshot | null;
}
export interface VoiceReply {
  serverNow: number;
  processingMs?: number;
  relayAgeMs?: number;
  guilds?: GuildSummary[];
  channels?: ChannelSummary[];
  status?: VoiceStatus;
}
