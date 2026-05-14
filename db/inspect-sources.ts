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
    // Distribution: pending vs classified vs failed per source.
    const rows = await db.execute(sql`
      SELECT
        s.name,
        COUNT(a.id) FILTER (WHERE a.status = 'pending')::int    AS pending,
        COUNT(a.id) FILTER (WHERE a.status = 'classified')::int AS classified,
        COUNT(a.id) FILTER (WHERE a.status = 'failed')::int     AS failed,
        COUNT(a.id)::int AS total
      FROM sources s
      LEFT JOIN articles a ON a.source_id = s.id
      GROUP BY s.id
      ORDER BY total DESC
    `);
    console.log("[articles by source]");
    console.log("name".padEnd(30), "pend".padStart(6), "class".padStart(6), "fail".padStart(6), "tot".padStart(6));
    for (const r of rows) {
      console.log(
        String(r.name).padEnd(30),
        String(r.pending).padStart(6),
        String(r.classified).padStart(6),
        String(r.failed).padStart(6),
        String(r.total).padStart(6),
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[inspect-sources] failed:", err);
  process.exit(1);
});
