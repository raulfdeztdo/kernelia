import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "@/lib/auth/passwords";

/**
 * Policy + hash/verify roundtrip. bcrypt is slow by design (~250ms per
 * call on this hardware) so we keep the hash-touching specs to the
 * minimum that actually proves the contract: a fresh hash verifies
 * round-trip, a wrong password fails, a tampered hash fails.
 */
describe("validatePasswordPolicy", () => {
  it("accepts a password at exactly the minimum length", () => {
    const minOk = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(validatePasswordPolicy(minOk)).toBe(null);
  });

  it("rejects shorter than minimum with `too_short`", () => {
    expect(validatePasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe("too_short");
    expect(validatePasswordPolicy("")).toBe("too_short");
  });

  it("rejects > 256 chars with `too_long`", () => {
    expect(validatePasswordPolicy("a".repeat(257))).toBe("too_long");
  });

  it("rejects non-string values with `not_a_string`", () => {
    expect(validatePasswordPolicy(undefined)).toBe("not_a_string");
    expect(validatePasswordPolicy(123)).toBe("not_a_string");
    expect(validatePasswordPolicy({})).toBe("not_a_string");
  });
});

describe("hashPassword + verifyPassword", () => {
  it("round-trips a valid password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt-encoded shape
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it("rejects a wrong password against a valid hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong horse battery staple", hash)).toBe(false);
  });

  it("returns false (not throws) for a null/empty stored hash", async () => {
    // This is the "user has no password set yet" path — login must treat
    // it identically to "wrong password" so account-state isn't leaked.
    expect(await verifyPassword("any password works", null)).toBe(false);
    expect(await verifyPassword("any password works", "")).toBe(false);
  });

  it("returns false for a malformed stored hash", async () => {
    expect(await verifyPassword("any password works", "not-a-bcrypt-hash")).toBe(false);
  });

  it("hashPassword throws on a policy violation", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/too_short/);
  });
});
