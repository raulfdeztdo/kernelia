/**
 * One-off: dump the first N rows that `listPendingArticles` will return.
 * Lets us confirm visually that the queue spreads across sources before
 * we trust the next cron tick.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  const { listPendingArticles } = await import("./queries/articles");
  const limit = Number.parseInt(process.argv[2] ?? "16", 10);
  const rows = await listPendingArticles(limit);
  console.log(`[next ${limit} from queue]`);
  rows.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}.`,
      r.sourceName.padEnd(28),
      r.title.slice(0, 70),
    );
  });
  // Source-distribution summary so we can eyeball the spread.
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.sourceName, (dist.get(r.sourceName) ?? 0) + 1);
  console.log("\n[spread]");
  for (const [name, n] of [...dist.entries()].toSorted((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${n}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[inspect-pending-order] failed:", err);
  process.exit(1);
});
