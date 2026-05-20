import { describe, expect, it } from "vitest";
import { PUBLIC_FEED_MIN_RELEVANCE_SCORE } from "@/db/queries/articles";
import {
  WEEKLY_DIGEST_PER_SOURCE_CAP,
  WEEKLY_DIGEST_TOP_N,
} from "@/lib/newsletter/digest";
import { DEFAULT_MIN_RELEVANCE_SCORE } from "@/lib/broadcast/run";

/**
 * Pin the cross-surface policy knobs so an accidental tuning shows up
 * as a test failure rather than silently shifting what readers and
 * subscribers see. These constants describe the contract documented
 * in PLAN.md and answered to the operator in chat — changing any of
 * them is intentional and must update both this file and the docs.
 */

describe("public-surface policy constants", () => {
  it("home feed gate is looser than broadcaster gate, stricter than 'anything classified'", () => {
    // Layering: home >= 0.5 (just enough to filter the long tail of
    // tangential AI-adjacent items) < broadcast 0.75 (only confident
    // picks make it to social channels). The newsletter intentionally
    // has no relevance minimum beyond "score is not null" — it relies
    // on the top-N cut instead.
    expect(PUBLIC_FEED_MIN_RELEVANCE_SCORE).toBe(0.5);
    expect(DEFAULT_MIN_RELEVANCE_SCORE).toBe(0.75);
    expect(PUBLIC_FEED_MIN_RELEVANCE_SCORE).toBeLessThan(DEFAULT_MIN_RELEVANCE_SCORE);
    expect(PUBLIC_FEED_MIN_RELEVANCE_SCORE).toBeGreaterThan(0);
  });

  it("digest per-source cap is small enough to keep the email diverse", () => {
    // 2/source over 10 total = max 20% from any one publisher. Higher
    // would let a single noisy week (one source classifying 5+ strong
    // items) take half the digest — the very monopoly the cap exists
    // to prevent.
    expect(WEEKLY_DIGEST_PER_SOURCE_CAP).toBe(2);
    expect(WEEKLY_DIGEST_PER_SOURCE_CAP).toBeLessThan(WEEKLY_DIGEST_TOP_N);
  });
});
