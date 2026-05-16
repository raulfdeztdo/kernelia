import { describe, expect, it } from "vitest";
import type { HealthResult } from "@/lib/health";

/**
 * Type-level contract for `HealthResult`. The dashboard `HealthCard` and
 * the `/api/health` route both branch on `result.status`, so the union
 * needs to keep its two arms in sync. If a third arm is added later,
 * these specs must be updated alongside the renderers.
 */

describe("HealthResult", () => {
  it("on ok carries uptime, lastIngest, counts and ts", () => {
    const sample: HealthResult = {
      status: "ok",
      uptimeMs: 120,
      lastIngestAt: "2026-05-16T00:00:00.000Z",
      articles: { total: 100, classified: 90, pending: 8, failed: 2 },
      ts: "2026-05-16T00:01:00.000Z",
    };
    expect(sample.status).toBe("ok");
    if (sample.status === "ok") {
      expect(sample.articles.classified).toBe(90);
      expect(sample.lastIngestAt).toBe("2026-05-16T00:00:00.000Z");
    }
  });

  it("on error carries reason and ts only", () => {
    const sample: HealthResult = {
      status: "error",
      reason: "connect ECONNREFUSED",
      ts: "2026-05-16T00:01:00.000Z",
    };
    expect(sample.status).toBe("error");
    if (sample.status === "error") {
      expect(sample.reason).toBe("connect ECONNREFUSED");
    }
  });

  it("allows lastIngestAt to be null for an empty DB", () => {
    const sample: HealthResult = {
      status: "ok",
      uptimeMs: 12,
      lastIngestAt: null,
      articles: { total: 0, classified: 0, pending: 0, failed: 0 },
      ts: "2026-05-16T00:01:00.000Z",
    };
    if (sample.status === "ok") {
      expect(sample.lastIngestAt).toBeNull();
    }
  });
});
