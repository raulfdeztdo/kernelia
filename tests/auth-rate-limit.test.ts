import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "@/lib/auth/rate-limit";

describe("consumeRateLimit", () => {
  function freshStore() {
    return { hits: new Map<string, number[]>() };
  }

  it("allows up to `max` events inside the window", () => {
    const store = freshStore();
    const opts = { max: 3, windowMs: 60_000 };
    expect(consumeRateLimit("ip:1.2.3.4", opts, store, 1000).allowed).toBe(true);
    expect(consumeRateLimit("ip:1.2.3.4", opts, store, 1100).allowed).toBe(true);
    expect(consumeRateLimit("ip:1.2.3.4", opts, store, 1200).allowed).toBe(true);
    const denied = consumeRateLimit("ip:1.2.3.4", opts, store, 1300);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("ages out events outside the window so new attempts succeed", () => {
    const store = freshStore();
    const opts = { max: 2, windowMs: 1000 };
    expect(consumeRateLimit("k", opts, store, 1000).allowed).toBe(true);
    expect(consumeRateLimit("k", opts, store, 1100).allowed).toBe(true);
    expect(consumeRateLimit("k", opts, store, 1500).allowed).toBe(false);
    // Both events from 1000 / 1100 have aged out by t=2200
    expect(consumeRateLimit("k", opts, store, 2200).allowed).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    const store = freshStore();
    const opts = { max: 1, windowMs: 10_000 };
    expect(consumeRateLimit("a", opts, store, 1000).allowed).toBe(true);
    expect(consumeRateLimit("a", opts, store, 1500).allowed).toBe(false);
    // Different key → not affected.
    expect(consumeRateLimit("b", opts, store, 1500).allowed).toBe(true);
  });

  it("reports a sane retryAfterMs equal to (oldest + window - now)", () => {
    const store = freshStore();
    const opts = { max: 1, windowMs: 10_000 };
    consumeRateLimit("k", opts, store, 1000);
    const denied = consumeRateLimit("k", opts, store, 3000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(8000); // 1000 + 10000 - 3000
  });

  it("reports `remaining` after an allowed event", () => {
    const store = freshStore();
    const opts = { max: 5, windowMs: 60_000 };
    expect(consumeRateLimit("k", opts, store, 1).remaining).toBe(4);
    expect(consumeRateLimit("k", opts, store, 2).remaining).toBe(3);
  });
});
