import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  // All these dynamic imports are independent — race them.
  const [
    { drizzle },
    drizzleOrm,
    postgresMod,
    schema,
    sourcesMod,
    rssMod,
  ] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("drizzle-orm"),
    import("postgres"),
    import("./schema"),
    import("@/db/queries/sources"),
    import("@/lib/ingest/rss"),
  ]);
  const { sql, eq, and, isNull } = drizzleOrm;
  const postgres = postgresMod.default;
  const { listActiveSources } = sourcesMod;
  const { fetchFeed } = rssMod;

  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL[_DIRECT] is not set");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const sources = await listActiveSources();
    let totalUpdated = 0;
    let totalFetched = 0;

    // One-off admin script with `max: 1` postgres pool. Parallelising
    // the per-source and per-item loops would serialise behind the
    // single connection anyway and obscure the progress logs. Keep
    // sequential and visible.
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
