import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const hmac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value).digest("base64url");

export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function seal(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${hmac(secret, payload)}`;
}

export function unseal(value: string | undefined, secret: string, now = Date.now()): unknown {
  if (!value || value.length > 4096) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !secureEqual(signature, hmac(secret, payload)))
    return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("expiresAt" in parsed) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signRequest(
  secret: string,
  actor: string,
  body: string,
  now = Date.now(),
  nonce = randomBytes(24).toString("base64url"),
): Record<string, string> {
  const timestamp = String(now);
  // Method and path are fixed by the protocol; no unsigned forwarding endpoints.
  const signature = hmac(secret, ["POST", "/v1/control", timestamp, nonce, actor, body].join("\n"));
  return {
    "content-type": "application/json",
    "x-rally-actor": actor,
    "x-rally-time": timestamp,
    "x-rally-nonce": nonce,
    "x-rally-signature": signature,
  };
}

export class RequestVerifier {
  private readonly nonces = new Map<string, number>();
  constructor(
    private readonly secret: string,
    private readonly allowedUsers: Set<string>,
  ) {}

  verify(headers: Headers, body: string, now = Date.now()): string | null {
    const actor = headers.get("x-rally-actor") ?? "";
    const timestamp = headers.get("x-rally-time") ?? "";
    const nonce = headers.get("x-rally-nonce") ?? "";
    const signature = headers.get("x-rally-signature") ?? "";
    if (
      !this.allowedUsers.has(actor) ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp)) > 30_000 ||
      !/^[\w-]{32}$/.test(nonce)
    )
      return null;
    const expected = hmac(
      this.secret,
      ["POST", "/v1/control", timestamp, nonce, actor, body].join("\n"),
    );
    if (!secureEqual(signature, expected)) return null;
    for (const [key, expiresAt] of this.nonces) if (expiresAt <= now) this.nonces.delete(key);
    if (this.nonces.has(nonce) || this.nonces.size >= 10_000) return null;
    // A timestamp up to 30 seconds in the future remains valid for 60 seconds.
    this.nonces.set(nonce, Number(timestamp) + 30_001);
    return actor;
  }
}
