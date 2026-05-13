import { config } from "dotenv";
import { notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { seedCategories, seedSources } from "./seed-data";

config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL[_DIRECT] is not set");

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const catRows = await db
      .insert(schema.categories)
      .values([...seedCategories])
      .onConflictDoNothing({ target: schema.categories.slug })
      .returning({ slug: schema.categories.slug });
    // eslint-disable-next-line no-console
    console.log(`[seed] categories upserted: ${catRows.length}`);

    // Authoritative seed: remove sources not declared in seedSources.
    const allowedRssUrls = seedSources.map((s) => s.rssUrl);
    const removed = await db
      .delete(schema.sources)
      .where(notInArray(schema.sources.rssUrl, allowedRssUrls))
      .returning({ name: schema.sources.name });
    // eslint-disable-next-line no-console
    console.log(`[seed] sources removed: ${removed.length}`);

    const srcRows = await db
      .insert(schema.sources)
      .values([...seedSources])
      .onConflictDoNothing({ target: schema.sources.rssUrl })
      .returning({ name: schema.sources.name });
    // eslint-disable-next-line no-console
    console.log(`[seed] sources inserted: ${srcRows.length}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[seed] failed:", err);
  process.exit(1);
});
