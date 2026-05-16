import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FORGOT_PASSWORD_PER_EMAIL_LIMIT,
  FORGOT_PASSWORD_PER_IP_LIMIT,
  requestPasswordReset,
} from "@/lib/auth/forgot-password-flow";
import type { User } from "@/db/queries/users";

/**
 * Pure-logic coverage for the forgot-password orchestration. The real DB,
 * Resend HTTP call and global rate-limit Map are all swapped out via the
 * collaborator injectables so each spec is independent.
 *
 * Mirror of the previous magic-link-flow tests; the contract is identical
 * except the link points at `/admin/reset-password` and the verb is "reset"
 * not "magic-link".
 */

const adminUser: User = {
  id: "user-1",
  email: "raul@kernelia.dev",
  userType: "admin",
  active: true,
  passwordHash: null, // bootstrap case: user has no password yet
  createdAt: new Date("2026-05-15T00:00:00Z"),
  lastLoginAt: null,
};

function freshStore() {
  return { hits: new Map<string, number[]>() };
}

function makeDeps() {
  return {
    findUserByEmail: vi.fn(async (_email: string): Promise<User | null> => adminUser),
    generateToken: vi.fn(async (_userId: string): Promise<{ plaintext: string }> => ({
      plaintext: "tok-plain",
    })),
    send: vi.fn(async (_p: { to: string; link: string }): Promise<unknown> => ({ id: "rsd-1" })),
  };
}

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns `sent` and emails the user on a happy path", async () => {
    const deps = makeDeps();
    const store = freshStore();
    const result = await requestPasswordReset({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: store,
    });
    expect(result.kind).toBe("sent");
    expect(deps.send).toHaveBeenCalledTimes(1);
    const sentArg = deps.send.mock.calls[0]?.[0];
    if (!sentArg) throw new Error("send was not called");
    expect(sentArg.to).toBe("raul@kernelia.dev");
    expect(sentArg.link).toBe(
      "https://kernelia.dev/admin/reset-password?token=tok-plain",
    );
  });

  it("normalises the email (trim + lowercase) before lookup", async () => {
    const deps = makeDeps();
    const store = freshStore();
    await requestPasswordReset({
      rawEmail: "  Raul@Kernelia.dev  ",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: store,
    });
    expect(deps.findUserByEmail).toHaveBeenCalledWith("raul@kernelia.dev");
  });

  it("returns `invalid_email` for malformed input", async () => {
    const result = await requestPasswordReset({
      rawEmail: "not-an-email",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...makeDeps(),
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("invalid_email");
  });

  it("returns `unknown_email` (no send) when the user does not exist", async () => {
    const deps = makeDeps();
    deps.findUserByEmail = vi.fn(async (_email: string): Promise<User | null> => null);
    const result = await requestPasswordReset({
      rawEmail: "ghost@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("unknown_email");
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("returns `inactive_user` (no send) when the user is deactivated", async () => {
    const deps = makeDeps();
    deps.findUserByEmail = vi.fn(async (): Promise<User | null> => ({ ...adminUser, active: false }));
    const result = await requestPasswordReset({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("inactive_user");
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("strips a trailing slash from the origin when building the reset URL", async () => {
    const deps = makeDeps();
    await requestPasswordReset({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev/", // trailing slash
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(deps.send.mock.calls[0]?.[0]?.link).toBe(
      "https://kernelia.dev/admin/reset-password?token=tok-plain",
    );
  });

  it("rate-limits by IP after `max` attempts in the window", async () => {
    const store = freshStore();
    const deps = makeDeps();
    deps.findUserByEmail = vi.fn(async (): Promise<User | null> => null); // unknown_email each time

    for (let i = 0; i < FORGOT_PASSWORD_PER_IP_LIMIT.max; i++) {
      const r = await requestPasswordReset({
        rawEmail: `user${i}@x.com`,
        ip: "1.2.3.4",
        origin: "https://kernelia.dev",
        ...deps,
        rateLimitStore: store,
      });
      expect(r.kind).toBe("unknown_email");
    }
    const limited = await requestPasswordReset({
      rawEmail: "user-final@x.com",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: store,
    });
    expect(limited.kind).toBe("rate_limited");
    if (limited.kind === "rate_limited") {
      expect(limited.reason).toBe("ip");
    }
  });

  it("rate-limits by email even across different IPs", async () => {
    const store = freshStore();
    const deps = makeDeps();
    for (let i = 0; i < FORGOT_PASSWORD_PER_EMAIL_LIMIT.max; i++) {
      await requestPasswordReset({
        rawEmail: "raul@kernelia.dev",
        ip: `10.0.0.${i + 1}`,
        origin: "https://kernelia.dev",
        ...deps,
        rateLimitStore: store,
      });
    }
    const limited = await requestPasswordReset({
      rawEmail: "raul@kernelia.dev",
      ip: "10.0.0.99",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: store,
    });
    expect(limited.kind).toBe("rate_limited");
    if (limited.kind === "rate_limited") {
      expect(limited.reason).toBe("email");
    }
  });

  it("returns `error` (not `sent`) when the email provider throws", async () => {
    const deps = makeDeps();
    deps.send = vi.fn(async () => {
      throw new Error("resend boom");
    });
    const result = await requestPasswordReset({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      ...deps,
      rateLimitStore: freshStore(),
    });
    expect(result.kind).toBe("error");
  });
});
