import { config } from "dotenv";
import { notInArray, sql } from "drizzle-orm";
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

    // Initial admin (Phase 7). Only seeded when:
    //   1) INITIAL_ADMIN_EMAIL is set, and
    //   2) the users table is still empty.
    // Idempotent: re-running the seed never touches existing users.
    //
    // The seeded user has NO password (`password_hash = NULL`). From Phase
    // 7.F onward, the bootstrap path is:
    //   1) seed creates the row with email only,
    //   2) operator goes to `/admin/login`, clicks "forgot password",
    //   3) Resend delivers a reset link,
    //   4) operator sets their first password via `/admin/reset-password`.
    // This is the same path admin-added users walk; no separate "set
    // initial password" mechanism exists.
    const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    if (initialAdminEmail) {
      const countRows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.users);
      const n = countRows[0]?.n ?? 0;
      if (n === 0) {
        await db.insert(schema.users).values({
          email: initialAdminEmail,
          userType: "admin",
          active: true,
        });
        // eslint-disable-next-line no-console
        console.log(`[seed] initial admin inserted: ${initialAdminEmail}`);
        // eslint-disable-next-line no-console
        console.log(
          "[seed] no password set — bootstrap via /admin/login → 'forgot password' → reset link",
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(`[seed] users table already populated (${n} rows) — skipping admin seed`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("[seed] INITIAL_ADMIN_EMAIL not set — skipping admin seed");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[seed] failed:", err);
  process.exit(1);
});
