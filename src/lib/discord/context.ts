import { createContext, useContext } from "react";
import type {
  DiscordSession,
  RallyPlan,
  VoiceLanguage,
  VoiceReply,
  VoiceRequest,
  VoiceStatus,
} from "@rally-sync/discord";

export interface TimedReply {
  reply: VoiceReply;
  receivedAt: number;
  roundTrip: number;
  snapshotAge: number;
}
interface VoiceContext {
  session: DiscordSession | null;
  guildId: string;
  automatic: boolean;
  language: VoiceLanguage;
  status: VoiceStatus | null;
  timing: TimedReply | null;
  request: (input: VoiceRequest) => Promise<TimedReply>;
  startRally: (plan: Omit<RallyPlan, "id" | "language">) => Promise<TimedReply>;
  preparing: boolean;
}
export const DiscordVoiceContext = createContext<VoiceContext | null>(null);
export const useDiscordVoice = () => useContext(DiscordVoiceContext);
