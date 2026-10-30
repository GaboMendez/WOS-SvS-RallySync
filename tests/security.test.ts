import { describe, expect, test } from "bun:test";
import { RequestVerifier, seal, signRequest, unseal } from "@rally-sync/discord/security";

const secret = "test-shared-secret-at-least-32-characters";
const actor = "123456789012345678";
const now = 1_800_000_000_000;
const body = JSON.stringify({ op: "guilds" });
const verifier = () => new RequestVerifier(secret, new Set([actor]));

describe("signed service requests", () => {
  test("accepts a signed authorized request exactly once", () => {
    const verify = verifier();
    const headers = new Headers(signRequest(secret, actor, body, now));
    expect(verify.verify(headers, body, now)).toBe(actor);
    expect(verify.verify(headers, body, now)).toBeNull();
  });
  test("rejects modified payloads, forged actors and invalid signatures", () => {
    const headers = new Headers(signRequest(secret, actor, body, now));
    expect(verifier().verify(headers, body + " ", now)).toBeNull();
    headers.set("x-rally-actor", "999999999999999999");
    expect(verifier().verify(headers, body, now)).toBeNull();
    headers.set("x-rally-actor", actor);
    headers.set("x-rally-signature", "forged");
    expect(verifier().verify(headers, body, now)).toBeNull();
  });
  test("rejects old and excessively future timestamps", () => {
    const headers = new Headers(signRequest(secret, actor, body, now));
    expect(verifier().verify(headers, body, now + 30_001)).toBeNull();
    expect(verifier().verify(headers, body, now - 30_001)).toBeNull();
  });
  test("retains future nonces for their entire validity window", () => {
    const verify = verifier();
    const future = new Headers(signRequest(secret, actor, body, now + 29_000));
    expect(verify.verify(future, body, now)).toBe(actor);
    expect(
      verify.verify(
        new Headers(signRequest(secret, actor, body, now + 31_000)),
        body,
        now + 31_000,
      ),
    ).toBe(actor);
    expect(verify.verify(future, body, now + 31_000)).toBeNull();
  });
  test("rejects requests without an explicit user allowlist", () => {
    const verify = new RequestVerifier(secret, new Set());
    expect(verify.verify(new Headers(signRequest(secret, actor, body, now)), body, now)).toBeNull();
  });
});

describe("session cookies", () => {
  test("rejects tampering, expiration and a different signing secret", () => {
    const data = { id: actor, expiresAt: now + 1000 };
    const cookie = seal(data, secret);
    expect(unseal(cookie, secret, now)).toEqual(data);
    expect(unseal(cookie, secret, now + 1000)).toBeNull();
    expect(unseal(cookie, "a-different-secret", now)).toBeNull();
    expect(unseal(cookie + "x", secret, now)).toBeNull();
    expect(unseal(undefined, secret, now)).toBeNull();
    expect(unseal(seal({ id: actor }, secret), secret, now)).toBeNull();
  });
});
