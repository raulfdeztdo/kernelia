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
    const result = await db.execute(sql`
      UPDATE articles
      SET status = 'pending', classification_error = NULL
      WHERE status = 'failed'
      RETURNING id
    `);
    console.log(`[reset] Reset ${result.length} failed articles to pending`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[reset] failed:", err);
  process.exit(1);
});
