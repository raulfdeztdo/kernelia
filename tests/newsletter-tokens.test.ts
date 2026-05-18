import { describe, expect, it } from "vitest";
import { generateNewsletterToken, hashToken, NEWSLETTER_TOKEN_BYTES } from "@/lib/newsletter/tokens";

/**
 * Token primitives. The interesting properties:
 *  - Two calls return two different plaintexts (no static seed).
 *  - `hash(plaintext)` is deterministic.
 *  - The hash is a hex digest (sha256 → 64 chars).
 *
 * The actual cryptographic strength of `randomBytes` + sha256 is the
 * Node runtime's contract; we don't re-test that here.
 */

describe("generateNewsletterToken", () => {
  it("returns plaintext + hash, both populated", () => {
    const t = generateNewsletterToken();
    expect(t.plaintext.length).toBeGreaterThan(0);
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issues a different plaintext on every call", () => {
    const a = generateNewsletterToken();
    const b = generateNewsletterToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it("plaintext is at least NEWSLETTER_TOKEN_BYTES of base64url material", () => {
    const t = generateNewsletterToken();
    // base64url encodes 3 bytes → 4 chars, ceiling. For 32 bytes that's 43 chars.
    const minLength = Math.ceil((NEWSLETTER_TOKEN_BYTES * 4) / 3) - 2;
    expect(t.plaintext.length).toBeGreaterThanOrEqual(minLength);
    expect(t.plaintext).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    const a = hashToken("abc");
    const b = hashToken("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches the hash returned by generateNewsletterToken for its own plaintext", () => {
    const t = generateNewsletterToken();
    expect(hashToken(t.plaintext)).toBe(t.hash);
  });

  it("produces different digests for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
