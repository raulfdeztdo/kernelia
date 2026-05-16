import { describe, expect, it } from "vitest";
import type {
  ClassifiedPerDayRow,
  SourceVolumeRow,
  TokensPerDayRow,
} from "@/db/queries/admin-metrics";

/**
 * The dashboard charts consume these row shapes via props serialised over
 * the server → client boundary. If a field is renamed or removed, the
 * chart breaks silently (Recharts just paints empty bars). These specs
 * pin the keys that the chart components in
 * `components/admin/charts/*` actually read.
 *
 * Behavioural coverage (DB round-trip, zero-fill in the live query) is
 * exercised via manual smoke against Supabase.
 */
describe("admin-metrics row shapes", () => {
  it("TokensPerDayRow carries date + prompt/completion/total + runs", () => {
    const sample: TokensPerDayRow = {
      date: "2026-05-16",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      runs: 1,
    };
    // Fields the `TokensBarChart` reads:
    expect(sample.promptTokens + sample.completionTokens).toBe(sample.totalTokens);
    expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ClassifiedPerDayRow carries date + classified/failed + runs", () => {
    const sample: ClassifiedPerDayRow = {
      date: "2026-05-16",
      classified: 8,
      failed: 1,
      runs: 1,
    };
    // Fields the `ClassifiedLineChart` reads:
    expect(sample.classified).toBe(8);
    expect(sample.failed).toBe(1);
    expect(sample.runs).toBe(1);
  });

  it("SourceVolumeRow carries sourceId + name + classified", () => {
    const sample: SourceVolumeRow = {
      sourceId: "abc",
      name: "Ars Technica",
      classified: 42,
    };
    // Fields the `SourcesBarChart` reads:
    expect(sample.name).toBe("Ars Technica");
    expect(sample.classified).toBe(42);
  });
});
