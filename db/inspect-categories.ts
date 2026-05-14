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
    // 1. Distribución exacta de slugs en classified articles.
    const dist = await db.execute(sql`
      SELECT
        c.slug,
        COUNT(a.id)::int AS articles
      FROM categories c
      LEFT JOIN articles a ON a.category_id = c.id AND a.status = 'classified'
      GROUP BY c.slug
      ORDER BY articles DESC
    `);
    console.log("[classified by category slug]");
    dist.forEach((r) => console.log(`  ${r.slug}: ${r.articles}`));

    // 2. Articulos classified sin category_id (huerfanos).
    const orphans = await db.execute(sql`
      SELECT COUNT(*)::int AS orphans
      FROM articles
      WHERE status = 'classified' AND category_id IS NULL
    `);
    console.log("[classified with NULL category_id]", orphans[0]);

    // 3. Muestra de 3 articulos por slug, con su slug crudo y titulo.
    const sample = await db.execute(sql`
      SELECT
        c.slug AS category_slug,
        a.title_es,
        a.title,
        a.status
      FROM articles a
      JOIN categories c ON c.id = a.category_id
      WHERE a.status = 'classified'
      ORDER BY a.published_at DESC
      LIMIT 30
    `);
    console.log("\n[30 most recent classified — slug + title]");
    sample.forEach((r) => {
      const title = (r.title_es as string | null) ?? (r.title as string);
      console.log(`  [${r.category_slug}] ${title.slice(0, 80)}`);
    });

    // 4. Verificar que los slugs de la DB coinciden con los canonicos
    //    declarados en lib/ai/schemas.ts (CATEGORY_SLUGS).
    const allSlugs = await db.execute(sql`SELECT slug FROM categories ORDER BY slug`);
    console.log("\n[slugs in DB]", allSlugs.map((r) => r.slug).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[inspect-categories] failed:", err);
  process.exit(1);
});
