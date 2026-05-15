import { describe, expect, it } from "vitest";
import { hashToken, MAGIC_LINK_TTL_MS } from "@/lib/auth/tokens";

/**
 * Pure-helper coverage for magic-link tokens. The DB-touching helpers
 * (`generateMagicLinkToken`, `verifyAndConsumeMagicLink`) get integration
 * coverage in sub-phase 7.B once `/api/admin/magic-link` and the auth
 * callback route exist and can be exercised end-to-end against a test DB.
 */
describe("magic-link tokens (pure helpers)", () => {
  it("hashes plaintext deterministically with SHA-256", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    // SHA-256 hex = 64 chars, lowercase
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never echoes the plaintext into the hash", () => {
    const plaintext = "supersecret-very-distinctive-string";
    const hash = hashToken(plaintext);
    expect(hash).not.toContain("supersecret");
    expect(hash).not.toContain(plaintext);
  });

  it("declares the 15 minute TTL as the magic-link expiry budget", () => {
    expect(MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });
});
