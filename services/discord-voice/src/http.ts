import { voiceRequestSchema, type VoiceReply, type VoiceRequest } from "@rally-sync/discord";
import { RequestVerifier } from "@rally-sync/discord/security";
import { VoiceError } from "./errors";

export interface ControlTarget {
  ready(): boolean;
  control(input: VoiceRequest, actor: string): Promise<VoiceReply>;
}

export function createControlHandler(
  target: ControlTarget,
  secret: string,
  allowedUsers: Set<string>,
) {
  const verifier = new RequestVerifier(secret, allowedUsers);
  const rates = new Map<string, { count: number; resetAt: number }>();
  const json = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: target.ready() }, target.ready() ? 200 : 503);
    }
    if (url.pathname !== "/v1/control") return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("content-type") !== "application/json")
      return json({ error: "JSON required." }, 415);
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: "Request body required." }, 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 16_384) {
          await reader.cancel();
          return json({ error: "Request too large." }, 413);
        }
        chunks.push(value);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const actor = verifier.verify(request.headers, body);
      if (!actor) return json({ error: "Unauthorized voice request." }, 401);
      const now = Date.now();
      for (const [key, rate] of rates) if (rate.resetAt <= now) rates.delete(key);
      const rate = rates.get(actor) ?? { count: 0, resetAt: now + 60_000 };
      rates.set(actor, rate);
      if (++rate.count > 180) return json({ error: "Too many requests. Wait a moment." }, 429);
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        return json({ error: "Invalid JSON." }, 400);
      }
      const parsed = voiceRequestSchema.safeParse(input);
      if (!parsed.success) return json({ error: "Invalid voice command." }, 400);
      const startedAt = performance.now();
      const reply = await target.control(parsed.data, actor);
      return json({ ...reply, processingMs: performance.now() - startedAt });
    } catch (error) {
      if (error instanceof VoiceError) return json({ error: error.message }, error.status);
      console.error("Voice control failed; check Discord connectivity and permissions.");
      return json(
        { error: "Discord could not complete this command. Check permissions and try again." },
        503,
      );
    }
  };
}
