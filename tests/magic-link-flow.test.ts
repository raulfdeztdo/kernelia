import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emailSchema,
  MAGIC_LINK_PER_EMAIL_LIMIT,
  MAGIC_LINK_PER_IP_LIMIT,
  requestMagicLink,
} from "@/lib/auth/magic-link-flow";
import type { User } from "@/db/queries/users";

function fakeUser(over: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "raul@kernelia.dev",
    userType: "admin",
    active: true,
    createdAt: new Date(),
    lastLoginAt: null,
    ...over,
  };
}

describe("emailSchema", () => {
  it("normalises trim + lowercase and accepts valid emails", () => {
    const r = emailSchema.safeParse("  Raul@Example.COM ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("raul@example.com");
  });

  it("rejects obviously bad input", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse(undefined).success).toBe(false);
    expect(emailSchema.safeParse(null).success).toBe(false);
    expect(emailSchema.safeParse(42).success).toBe(false);
  });

  it("caps length at 254 chars (RFC 5321)", () => {
    const longLocal = "a".repeat(255) + "@example.com";
    expect(emailSchema.safeParse(longLocal).success).toBe(false);
  });
});

describe("requestMagicLink", () => {
  function makeDeps() {
    const findUser = vi.fn(async (email: string): Promise<User | null> => {
      if (email === "raul@kernelia.dev") return fakeUser();
      if (email === "deactivated@kernelia.dev") return fakeUser({ active: false });
      return null;
    });
    const generateToken = vi.fn(
      async (_userId: string): Promise<{ plaintext: string }> => ({
        plaintext: "plaintext-token-secret",
      }),
    );
    const send = vi.fn(
      async (_params: { to: string; link: string }): Promise<unknown> => ({ id: "resend-msg-1" }),
    );
    const store = { hits: new Map<string, number[]>() };
    return { findUser, generateToken, send, store };
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("invalid emails return `invalid_email` without touching rate-limit", async () => {
    const deps = makeDeps();
    const r = await requestMagicLink({
      rawEmail: "not-an-email",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    });
    expect(r.kind).toBe("invalid_email");
    expect(deps.findUser).not.toHaveBeenCalled();
    expect(deps.generateToken).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("unknown emails return `unknown_email` and do NOT send", async () => {
    const deps = makeDeps();
    const r = await requestMagicLink({
      rawEmail: "ghost@example.com",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    });
    expect(r.kind).toBe("unknown_email");
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("inactive users return `inactive_user` and do NOT send", async () => {
    const deps = makeDeps();
    const r = await requestMagicLink({
      rawEmail: "deactivated@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    });
    expect(r.kind).toBe("inactive_user");
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("happy path: generates a token, builds the callback URL, and sends the email", async () => {
    const deps = makeDeps();
    const r = await requestMagicLink({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    });
    expect(r.kind).toBe("sent");
    expect(deps.generateToken).toHaveBeenCalledWith("user-1");
    expect(deps.send).toHaveBeenCalledTimes(1);
    const sentArg = deps.send.mock.calls[0]?.[0];
    if (!sentArg) throw new Error("send was not called");
    expect(sentArg.to).toBe("raul@kernelia.dev");
    expect(sentArg.link).toBe(
      "https://kernelia.dev/admin/auth/callback?token=plaintext-token-secret",
    );
  });

  it("strips a trailing slash from the origin when building the callback URL", async () => {
    const deps = makeDeps();
    await requestMagicLink({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev/",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    });
    const sentArg = deps.send.mock.calls[0]?.[0];
    if (!sentArg) throw new Error("send was not called");
    expect(sentArg.link.startsWith("https://kernelia.dev/admin/auth/callback?")).toBe(true);
  });

  it("rate-limits by IP after `max` attempts in the window", async () => {
    const deps = makeDeps();
    const base = {
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    };
    for (let i = 0; i < MAGIC_LINK_PER_IP_LIMIT.max; i++) {
      // Different emails to dodge the per-email limit; we want the per-IP
      // counter to be the one that trips.
      const r = await requestMagicLink({ ...base, rawEmail: `user${i}@x.com` });
      expect(r.kind).not.toBe("rate_limited");
    }
    const blocked = await requestMagicLink({ ...base, rawEmail: `another@x.com` });
    expect(blocked.kind).toBe("rate_limited");
    if (blocked.kind === "rate_limited") {
      expect(blocked.reason).toBe("ip");
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("rate-limits by email even across different IPs", async () => {
    const deps = makeDeps();
    const base = {
      rawEmail: "raul@kernelia.dev",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    };
    for (let i = 0; i < MAGIC_LINK_PER_EMAIL_LIMIT.max; i++) {
      const r = await requestMagicLink({ ...base, ip: `10.0.0.${i}` });
      expect(r.kind).not.toBe("rate_limited");
    }
    const blocked = await requestMagicLink({ ...base, ip: "10.0.0.99" });
    expect(blocked.kind).toBe("rate_limited");
    if (blocked.kind === "rate_limited") {
      expect(blocked.reason).toBe("email");
    }
  });

  it("returns `error` (not `sent`) when the email provider throws", async () => {
    const deps = makeDeps();
    deps.send.mockRejectedValueOnce(new Error("resend boom"));
    const r = await requestMagicLink({
      rawEmail: "raul@kernelia.dev",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      findUserByEmail: deps.findUser,
      generateToken: deps.generateToken,
      send: deps.send,
      rateLimitStore: deps.store,
    });
    expect(r.kind).toBe("error");
  });
});
