import "@tanstack/react-start/server-only";
import { signRequest } from "@rally-sync/discord/security";
import type { VoiceReply, VoiceRequest } from "@rally-sync/discord";
import { z } from "zod";
import { requireDiscordUser } from "./auth.server";

export async function callVoiceService(input: VoiceRequest): Promise<VoiceReply> {
  const user = requireDiscordUser();
  const service = new URL(z.string().url().parse(process.env["VOICE_SERVICE_URL"]));
  if (
    service.protocol !== "https:" &&
    !(service.protocol === "http:" && ["localhost", "127.0.0.1"].includes(service.hostname))
  )
    throw new Error("Voice service must use HTTPS.");
  const secret = z.string().min(32).parse(process.env["VOICE_SHARED_SECRET"]);
  const body = JSON.stringify(input);
  let response: Response;
  const sentAt = performance.now();
  try {
    response = await fetch(new URL("/v1/control", service), {
      method: "POST",
      headers: signRequest(secret, user.id, body),
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new Error("The Discord voice service is unavailable. Try again shortly.");
  }
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    const message = z.object({ error: z.string().max(300) }).safeParse(error);
    throw new Error(
      message.success ? message.data.error : "The voice service rejected the request.",
    );
  }
  const reply = (await response.json()) as VoiceReply;
  // Remove command work (permission checks, etc.) from the one-way latency estimate.
  const elapsed = performance.now() - sentAt;
  reply.relayAgeMs = Math.max(0, elapsed - (reply.processingMs ?? 0)) / 2;
  return reply;
}
