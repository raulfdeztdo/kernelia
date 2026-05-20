import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { ilike, or, desc } from "drizzle-orm";
import postgres from "postgres";
import { articles } from "../db/schema";

/**
 * One-shot diagnostic: find an article whose title_es matches `--needle`
 * and dump its title_es / title_en / summary_es as UTF-16 codepoints in
 * hex. Read-only: no UPDATE, no DELETE, no side effects beyond a SELECT.
 *
 * Usage:
 *   npx tsx scripts/inspect-title-bytes.ts "Android CLI"
 *
 * Why: the newsletter is showing tofu glyphs in the middle of accented
 * words ("codificaci(?)0n"). The hex dump tells us whether the stored
 * chars are precomposed Latin-1 ("ó" = U+00F3), NFD-style combining
 * marks ("o" + U+0301), or some hallucinated lookalike. Once we know
 * what the bytes actually are, we can pick the right fix
 * (NFC-normalize in classify, codepoint allowlist, prompt tweak).
 */

config({ path: ".env.local" });
config({ path: ".env", override: false });

function dumpCodepoints(label: string, s: string): void {
  console.log(`\n${label}: "${s}"`);
  const out: string[] = [];
  // Iterating with `for..of` yields full code points (handles surrogate pairs).
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const hex = cp.toString(16).toUpperCase().padStart(4, "0");
    const display =
      cp < 0x20 || cp === 0x7f
        ? "·"
        : ch;
    out.push(`${display}=U+${hex}`);
  }
  console.log(out.join(" "));
}

async function main() {
  const needle = process.argv[2];
  if (!needle) {
    console.error("Usage: npx tsx scripts/inspect-title-bytes.ts \"<title fragment>\"");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL[_DIRECT] is not set");

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  // Plain ILIKE — fine for a one-shot, the table is small.
  const rows = await db
    .select({
      id: articles.id,
      titleEs: articles.titleEs,
      titleEn: articles.titleEn,
      summaryEs: articles.summaryEs,
      url: articles.url,
      ingestedAt: articles.ingestedAt,
    })
    .from(articles)
    .where(
      or(
        ilike(articles.titleEs, `%${needle}%`),
        ilike(articles.titleEn, `%${needle}%`),
        ilike(articles.title, `%${needle}%`),
      ),
    )
    .orderBy(desc(articles.ingestedAt))
    .limit(3);

  if (rows.length === 0) {
    console.log(`No articles matched "${needle}".`);
    await client.end();
    return;
  }

  for (const row of rows) {
    console.log("─".repeat(72));
    console.log(`id:         ${row.id}`);
    console.log(`url:        ${row.url}`);
    console.log(`ingestedAt: ${row.ingestedAt.toISOString()}`);
    if (row.titleEs) dumpCodepoints("title_es", row.titleEs);
    if (row.titleEn) dumpCodepoints("title_en", row.titleEn);
    if (row.summaryEs) dumpCodepoints("summary_es (first 120 chars)", row.summaryEs.slice(0, 120));
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
