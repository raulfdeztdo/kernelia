import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

config({ path: ".env.local" });
config({ path: ".env", override: false });

async function main() {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL[_DIRECT] is not set");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    const counts = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM categories) AS categories,
        (SELECT COUNT(*) FROM sources WHERE active = true) AS active_sources,
        (SELECT COUNT(*) FROM articles) AS total_articles,
        (SELECT COUNT(*) FROM articles WHERE status = 'pending') AS pending_articles,
        (SELECT COUNT(*) FROM articles WHERE status = 'classified') AS classified_articles,
        (SELECT COUNT(*) FROM articles WHERE status = 'failed') AS failed_articles
    `);
    // eslint-disable-next-line no-console
    console.log("[counts]", counts[0]);

    const bySource = await db.execute(sql`
      SELECT s.name, COUNT(a.id)::int AS articles
      FROM sources s
      LEFT JOIN articles a ON a.source_id = s.id
      GROUP BY s.name
      ORDER BY articles DESC
    `);
    // eslint-disable-next-line no-console
    console.log("[by source]");
    // eslint-disable-next-line no-console
    bySource.forEach((row) => console.log(`  ${row.name}: ${row.articles}`));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[inspect] failed:", err);
  process.exit(1);
});
