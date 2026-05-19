// Rate-limit tests must drive attempts SEQUENTIALLY: the limiter is a
// sliding window keyed on IP + email, and the N+1 hit is exactly what
// verifies the cap. Parallelising would race the counter against itself
// and invalidate the test. Disabled file-wide for `async-await-in-loop`.
/* eslint-disable react-review/async-await-in-loop */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_PER_EMAIL_FAILURE_LIMIT,
  LOGIN_PER_IP_LIMIT,
  attemptLogin,
} from "@/lib/auth/login-flow";
import type { User } from "@/db/queries/users";

/**
 * Login flow contract: the unhappy paths matter as much as the happy one
 * because they're the surface where account enumeration / brute-force /
 * lockouts live. The real bcrypt verify is swapped out (it's slow and
 * already covered in `auth-passwords.test.ts`).
 */

const adminUser: User = {
  id: "user-1",
  email: "raul@kernelia.dev",
  userType: "admin",
  active: true,
  passwordHash: "$2b$12$pretend-real-bcrypt-hash-for-test",
  createdAt: new Date("2026-05-15T00:00:00Z"),
  lastLoginAt: null,
};

function freshStore() {
  return { hits: new Map<string, number[]>() };
}

function makeDeps() {
  return {
    findUserByEmail: vi.fn(async (_email: string): Promise<User | null> => adminUser),
    verify: vi.fn(async (_pw: string, _hash: string | null): Promise<boolean> => true),
    recordLastLogin: vi.fn(async (_id: string, _when: Date): Promise<void> => undefined),
  };
}

describe("attemptLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns `ok` on valid credentials and records last_login", async () => {
    const deps = makeDeps();
    const result = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "correct horse" },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("ok");
    expect(deps.recordLastLogin).toHaveBeenCalledTimes(1);
  });

  it("returns `invalid_body` on missing fields", async () => {
    const result = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev" }, // no password
      ip: "1.2.3.4",
      ...makeDeps(),
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("invalid_body");
  });

  it("normalises the email (trim + lowercase) before lookup", async () => {
    const deps = makeDeps();
    await attemptLogin({
      rawBody: { email: "  Raul@Kernelia.dev ", password: "correct horse" },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(deps.findUserByEmail).toHaveBeenCalledWith("raul@kernelia.dev");
  });

  it("maps unknown email to `invalid_credentials` (no enumeration leak)", async () => {
    const deps = makeDeps();
    deps.findUserByEmail = vi.fn(async (): Promise<User | null> => null);
    const result = await attemptLogin({
      rawBody: { email: "ghost@kernelia.dev", password: "anything" },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("invalid_credentials");
    // verify must NOT be called for an unknown user — it would be a wasted
    // bcrypt round-trip and could theoretically leak timing info.
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("maps inactive user to `invalid_credentials` (also no leak)", async () => {
    const deps = makeDeps();
    deps.findUserByEmail = vi.fn(async (): Promise<User | null> => ({ ...adminUser, active: false }));
    const result = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "anything" },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("invalid_credentials");
  });

  it("maps wrong password to `invalid_credentials`", async () => {
    const deps = makeDeps();
    deps.verify = vi.fn(async () => false);
    const result = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "wrong" },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("invalid_credentials");
  });

  it("user with NULL password_hash maps to `invalid_credentials`", async () => {
    // Bootstrap-but-never-set-yet case. We rely on verifyPassword returning
    // false on a null hash. This spec uses the real verifier shape: when
    // `verify` itself is called with a null hash, the result is false.
    const deps = makeDeps();
    deps.findUserByEmail = vi.fn(async (): Promise<User | null> => ({ ...adminUser, passwordHash: null }));
    deps.verify = vi.fn(async (_pw: string, hash: string | null) => hash !== null);
    const result = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "anything" },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("invalid_credentials");
  });

  it("rate-limits the IP after `max` attempts", async () => {
    const store = freshStore();
    const deps = makeDeps();
    deps.verify = vi.fn(async () => false); // every attempt fails
    for (let i = 0; i < LOGIN_PER_IP_LIMIT.max; i++) {
      const r = await attemptLogin({
        rawBody: { email: `user${i}@x.com`, password: "x".repeat(12) },
        ip: "1.2.3.4",
        ...deps,
        rateLimitStore: store,
      });
      expect(r.kind).toBe("invalid_credentials");
    }
    const limited = await attemptLogin({
      rawBody: { email: "user-final@x.com", password: "x".repeat(12) },
      ip: "1.2.3.4",
      ...deps,
      rateLimitStore: store,
    });
    expect(limited.kind).toBe("rate_limited");
    if (limited.kind === "rate_limited") expect(limited.reason).toBe("ip");
  });

  it("locks an email after N failed attempts across different IPs", async () => {
    const store = freshStore();
    const deps = makeDeps();
    deps.verify = vi.fn(async () => false);
    for (let i = 0; i < LOGIN_PER_EMAIL_FAILURE_LIMIT.max; i++) {
      const r = await attemptLogin({
        rawBody: { email: "raul@kernelia.dev", password: "x".repeat(12) },
        ip: `10.0.0.${i + 1}`,
        ...deps,
        rateLimitStore: store,
      });
      expect(r.kind).toBe("invalid_credentials");
    }
    const limited = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "x".repeat(12) },
      ip: "10.0.0.99",
      ...deps,
      rateLimitStore: store,
    });
    expect(limited.kind).toBe("rate_limited");
    if (limited.kind === "rate_limited") expect(limited.reason).toBe("email");
  });

  it("a SUCCESSFUL login does NOT consume the per-email failure budget", async () => {
    const store = freshStore();
    const deps = makeDeps();
    // Burn 4/5 of the per-email failure budget first.
    deps.verify = vi.fn(async () => false);
    for (let i = 0; i < LOGIN_PER_EMAIL_FAILURE_LIMIT.max - 1; i++) {
      await attemptLogin({
        rawBody: { email: "raul@kernelia.dev", password: "x".repeat(12) },
        ip: `10.0.0.${i + 1}`,
        ...deps,
        rateLimitStore: store,
      });
    }
    // Now the legitimate user logs in successfully — must NOT increment
    // the failure counter. If it did, the next failed attempt would lock
    // them out.
    deps.verify = vi.fn(async () => true);
    const success = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "correct" },
      ip: "10.0.0.99",
      ...deps,
      rateLimitStore: store,
    });
    expect(success.kind).toBe("ok");

    // One more failure should be allowed (still under max — success
    // didn't burn budget).
    deps.verify = vi.fn(async () => false);
    const stillUnderBudget = await attemptLogin({
      rawBody: { email: "raul@kernelia.dev", password: "wrong" },
      ip: "10.0.0.100",
      ...deps,
      rateLimitStore: store,
    });
    expect(stillUnderBudget.kind).toBe("invalid_credentials");
  });
});
