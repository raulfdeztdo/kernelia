import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { sql, eq, and, isNull } = await import("drizzle-orm");
  const postgres = (await import("postgres")).default;
  const schema = await import("./schema");
  const { listActiveSources } = await import("@/db/queries/sources");
  const { fetchFeed } = await import("@/lib/ingest/rss");

  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL[_DIRECT] is not set");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const sources = await listActiveSources();
    let totalUpdated = 0;
    let totalFetched = 0;

    for (const source of sources) {
      try {
        const items = await fetchFeed(source);
        totalFetched += items.length;
        let updated = 0;
        for (const item of items) {
          if (!item.imageUrl) continue;
          const result = await db
            .update(schema.articles)
            .set({ imageUrl: item.imageUrl })
            .where(
              and(eq(schema.articles.urlHash, item.urlHash), isNull(schema.articles.imageUrl)),
            )
            .returning({ id: schema.articles.id });
          updated += result.length;
        }
        totalUpdated += updated;
        console.log(`[backfill] ${source.name}: ${items.length} items, ${updated} updated`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[backfill] ${source.name}: FAILED — ${message}`);
      }
    }

    const stillMissing = await db.execute(sql`
      SELECT COUNT(*)::int AS missing FROM articles WHERE image_url IS NULL
    `);
    console.log(`[backfill] DONE — fetched ${totalFetched}, updated ${totalUpdated}`);
    console.log(`[backfill] articles still missing image:`, stillMissing[0]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
