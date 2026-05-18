import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUBSCRIBE_PER_EMAIL_LIMIT,
  SUBSCRIBE_PER_IP_LIMIT,
  subscribeEmailSchema,
  subscribeToNewsletter,
} from "@/lib/newsletter/subscribe-flow";
import type { NewsletterSubscriber } from "@/db/queries/newsletter";

/**
 * Subscribe flow specs. Stubbed upsert + sender to keep the suite hermetic
 * (no DB, no Resend). The flow's contract is:
 *  - Invalid emails → `invalid_email`, no DB/email side-effect.
 *  - Per-IP and per-email rate limits independently fire.
 *  - Happy path → upsert called, sender called with confirmUrl.
 *  - Upsert failure → `error` (not "sent"), email never attempted.
 */

const VALID_EMAIL = "ada@example.com";

function freshSubscriber(overrides: Partial<NewsletterSubscriber> = {}): NewsletterSubscriber {
  return {
    id: "sub-1",
    email: VALID_EMAIL,
    locale: "es",
    confirmTokenHash: "hash-c",
    unsubscribeToken: "tok-u",
    confirmedAt: null,
    unsubscribedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("subscribeEmailSchema", () => {
  it("trims and lowercases", () => {
    const r = subscribeEmailSchema.safeParse("  ADA@Example.COM  ");
    expect(r.success && r.data).toBe("ada@example.com");
  });

  it("rejects obvious junk", () => {
    expect(subscribeEmailSchema.safeParse("not-an-email").success).toBe(false);
    expect(subscribeEmailSchema.safeParse("").success).toBe(false);
    expect(subscribeEmailSchema.safeParse(123).success).toBe(false);
  });
});

describe("subscribeToNewsletter", () => {
  let upsert: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let store: { hits: Map<string, number[]> };

  beforeEach(() => {
    upsert = vi.fn().mockResolvedValue({ subscriber: freshSubscriber(), status: "new" });
    send = vi.fn().mockResolvedValue({ id: "msg-1" });
    store = { hits: new Map() };
  });

  it("happy path: returns sent, calls upsert + send", async () => {
    const out = await subscribeToNewsletter({
      rawEmail: VALID_EMAIL,
      rawLocale: "es",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(out.kind).toBe("sent");
    expect(upsert).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    const sendCall = send.mock.calls[0]?.[0];
    expect(sendCall.to).toBe(VALID_EMAIL);
    expect(sendCall.locale).toBe("es");
    // Link points to the locale-aware PAGE (`/newsletter/confirm`), not the
    // API endpoint, so email scanners can't trigger the mutation. The page
    // renders a POST form whose submit goes to `/api/newsletter/confirm`.
    expect(sendCall.confirmUrl).toMatch(/^https:\/\/kernelia\.dev\/newsletter\/confirm\?token=/);
  });

  it("invalid email → invalid_email, no side effects", async () => {
    const out = await subscribeToNewsletter({
      rawEmail: "not-an-email",
      rawLocale: "es",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(out.kind).toBe("invalid_email");
    expect(upsert).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("already-active subscriber: no email sent, outcome is noop_already_active (anti-DoS guard)", async () => {
    // Simulates the case where an attacker POSTs the email of a confirmed,
    // not-unsubscribed subscriber. Without the DB-side `setWhere` guard +
    // this flow-side short-circuit, that would silently reset the
    // subscriber's `confirmed_at` and stop their digests.
    upsert.mockResolvedValueOnce({
      subscriber: freshSubscriber({
        confirmedAt: new Date("2026-01-01T00:00:00Z"),
        unsubscribedAt: null,
      }),
      status: "already_active",
    });
    const out = await subscribeToNewsletter({
      rawEmail: VALID_EMAIL,
      rawLocale: "es",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(out.kind).toBe("noop_already_active");
    expect(upsert).toHaveBeenCalledOnce();
    // The critical invariant: no confirmation email leaves the system,
    // because the subscriber is already active. Sending one would (a)
    // annoy them and (b) be an enumeration oracle.
    expect(send).not.toHaveBeenCalled();
  });

  it("rearmed (previously unsubscribed): email IS sent so they can re-confirm", async () => {
    upsert.mockResolvedValueOnce({
      subscriber: freshSubscriber({
        // Re-arm wiped these in the upsert query; we model the post-update
        // state here.
        confirmedAt: null,
        unsubscribedAt: null,
      }),
      status: "rearmed",
    });
    const out = await subscribeToNewsletter({
      rawEmail: VALID_EMAIL,
      rawLocale: "es",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(out.kind).toBe("sent");
    if (out.kind === "sent") expect(out.status).toBe("rearmed");
    expect(send).toHaveBeenCalledOnce();
  });

  it("locale defaults to es when missing or invalid", async () => {
    await subscribeToNewsletter({
      rawEmail: VALID_EMAIL,
      rawLocale: "klingon",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(upsert.mock.calls[0]?.[0]?.locale).toBe("es");
  });

  it("per-IP rate-limit kicks in past the budget", async () => {
    for (let i = 0; i < SUBSCRIBE_PER_IP_LIMIT.max; i++) {
      const out = await subscribeToNewsletter({
        // Different email each call so the per-email limit doesn't fire first.
        rawEmail: `u${i}@example.com`,
        rawLocale: "es",
        ip: "9.9.9.9",
        origin: "https://kernelia.dev",
        upsert,
        send,
        rateLimitStore: store,
      });
      expect(out.kind).toBe("sent");
    }
    const denied = await subscribeToNewsletter({
      rawEmail: "blocked@example.com",
      rawLocale: "es",
      ip: "9.9.9.9",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(denied.kind).toBe("rate_limited");
    if (denied.kind === "rate_limited") expect(denied.reason).toBe("ip");
  });

  it("per-email rate-limit kicks in independently of IP", async () => {
    for (let i = 0; i < SUBSCRIBE_PER_EMAIL_LIMIT.max; i++) {
      const out = await subscribeToNewsletter({
        rawEmail: VALID_EMAIL,
        rawLocale: "es",
        // Different IP each call so the per-IP limit doesn't fire.
        ip: `10.0.0.${i}`,
        origin: "https://kernelia.dev",
        upsert,
        send,
        rateLimitStore: store,
      });
      expect(out.kind).toBe("sent");
    }
    const denied = await subscribeToNewsletter({
      rawEmail: VALID_EMAIL,
      rawLocale: "es",
      ip: "10.0.0.99",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(denied.kind).toBe("rate_limited");
    if (denied.kind === "rate_limited") expect(denied.reason).toBe("email");
  });

  it("upsert failure → error, email never attempted", async () => {
    upsert.mockRejectedValueOnce(new Error("db down"));
    const out = await subscribeToNewsletter({
      rawEmail: VALID_EMAIL,
      rawLocale: "es",
      ip: "1.2.3.4",
      origin: "https://kernelia.dev",
      upsert,
      send,
      rateLimitStore: store,
    });
    expect(out.kind).toBe("error");
    expect(send).not.toHaveBeenCalled();
  });
});
