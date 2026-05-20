import { config } from "dotenv";
import { eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { articles } from "../db/schema";

/**
 * One-shot cleanup for the Cerebras Llama 3.1 control-character bug.
 *
 * Background: until the schema guard in lib/ai/schemas.ts landed, the
 * classifier occasionally stored titles/summaries containing literal
 * C0/C1 control characters (broken `\uXXXX` escapes for Spanish
 * accented chars). They render as tofu glyphs in the newsletter.
 *
 * Strategy: mark every affected row as `status='hidden'` with
 * `classification_error='control_chars'`. That immediately removes
 * them from home / RSS / newsletter / broadcaster (all four surfaces
 * filter status='classified'), keeps the row for /admin/articles
 * audit, and lets the existing cleanup cron purge them after the
 * retention window — no manual DELETE needed.
 *
 * Run with:
 *   npx tsx scripts/hide-control-char-articles.ts        # dry-run
 *   npx tsx scripts/hide-control-char-articles.ts --apply
 *
 * Idempotent: re-running is a no-op once every affected row is hidden.
 */

config({ path: ".env.local" });
config({ path: ".env", override: false });

// Same character class as the schema guard. Keep in sync if you tune
// either. The leading set excludes \t \n \r so legitimate multi-line
// summaries don't get swept up.
const CONTROL_REGEX_SQL =
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL[_DIRECT] is not set");

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  // Find candidates. Postgres regex needs the `~` operator with the
  // raw pattern; we wrap each column lookup with COALESCE to handle
  // nulls (early-failed rows have null translations).
  const affected = await db
    .select({
      id: articles.id,
      title: articles.title,
      titleEs: articles.titleEs,
      titleEn: articles.titleEn,
      url: articles.url,
      status: articles.status,
    })
    .from(articles)
    .where(
      or(
        sql`COALESCE(${articles.titleEs}, '') ~ ${CONTROL_REGEX_SQL}`,
        sql`COALESCE(${articles.titleEn}, '') ~ ${CONTROL_REGEX_SQL}`,
        sql`COALESCE(${articles.summaryEs}, '') ~ ${CONTROL_REGEX_SQL}`,
        sql`COALESCE(${articles.summaryEn}, '') ~ ${CONTROL_REGEX_SQL}`,
      ),
    );

  console.log(`Found ${affected.length} article(s) with control chars in classified text.`);

  if (affected.length === 0) {
    await client.end();
    return;
  }

  for (const row of affected) {
    const preview = (row.titleEs ?? row.titleEn ?? row.title).slice(0, 80);
    console.log(`  - [${row.status}] ${row.id}  ${preview}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to mark these rows as hidden.");
    await client.end();
    return;
  }

  // Skip rows that are already hidden — keeps the script idempotent and
  // avoids overwriting an existing error tag (we'd rather not clobber
  // `non_ai`, `dup_of:*`, etc. just because someone re-ran the cleanup).
  const toUpdate = affected.filter((r) => r.status !== "hidden");
  console.log(`\nUpdating ${toUpdate.length} row(s) → status='hidden', classification_error='control_chars'.`);

  for (const row of toUpdate) {
    await db
      .update(articles)
      .set({
        status: "hidden",
        classificationError: "control_chars",
      })
      .where(eq(articles.id, row.id));
  }

  console.log("Done.");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
