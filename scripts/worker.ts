import { config } from "dotenv";

/**
 * Kernelia worker for Hepha (phase 9.D): jobs that used to run as Vercel
 * functions and now run on the Raspberry Pi, so they cost no Vercel CPU.
 *
 *   pnpm tsx scripts/worker.ts ingest     # RSS ingest + cron_runs row
 *   pnpm tsx scripts/worker.ts og-cards   # pre-render social cards into Storage
 *
 * Scheduled by `scripts/hepha/kernelia-worker.sh` (see `scripts/hepha/`).
 * Prints one JSON summary line and exits non-zero on failure, so the
 * wrapper can log it and report to Uptime Kuma.
 */

// Env first: `db/index.ts` reads DATABASE_URL when it is imported.
config({ path: process.env.KERNELIA_ENV_FILE ?? ".env.local", quiet: true });

const JOBS = ["ingest", "og-cards"] as const;
type Job = (typeof JOBS)[number];

function isJob(value: string | undefined): value is Job {
  return (JOBS as readonly string[]).includes(value ?? "");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function ingest(): Promise<boolean> {
  const { runIngestJob } = await import("@/lib/ingest/job");
  const result = await runIngestJob();
  console.log(JSON.stringify(result.ok ? { job: "ingest", ...result.summary.totals } : result));
  return result.ok;
}

async function ogCards(): Promise<boolean> {
  const [{ listArticlesForOgCards }, { renderArticleCard }, { StorageClient }, { runOgCardsJob }] =
    await Promise.all([
      import("@/db/queries/articles"),
      import("@/lib/og/card"),
      import("@/lib/og/storage"),
      import("@/lib/og/cards-job"),
    ]);
  const { createTranslator } = await import("next-intl");
  const { routing } = await import("@/i18n/routing");
  const messages = {
    es: (await import("@/messages/es.json")).default,
    en: (await import("@/messages/en.json")).default,
  };

  const storage = new StorageClient({
    supabaseUrl: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    serviceKey: requireEnv("SUPABASE_SERVICE_ROLE"),
  });

  const summary = await runOgCardsJob({
    listArticles: listArticlesForOgCards,
    listExisting: async () => {
      const lists = await Promise.all(
        routing.locales.map(async (locale) =>
          (await storage.list(`${locale}/`)).map((name) => `${locale}/${name}`),
        ),
      );
      return lists.flat();
    },
    renderCard: async (input) => new Uint8Array(await renderArticleCard(input).arrayBuffer()),
    upload: (path, png) => storage.upload(path, png),
    remove: (paths) => storage.remove(paths),
    labels: (locale) => {
      const categories = createTranslator({
        locale,
        messages: messages[locale],
        namespace: "categories",
      });
      const article = createTranslator({
        locale,
        messages: messages[locale],
        namespace: "article",
      });
      return {
        category: (slug) => categories(slug as Parameters<typeof categories>[0]),
        via: (source) => article("via", { source }),
      };
    },
  });
  console.log(JSON.stringify({ job: "og-cards", ...summary }));
  return summary.failed === 0;
}

async function main(): Promise<void> {
  const job = process.argv[2];
  if (!isJob(job)) {
    console.error(`usage: worker.ts <${JOBS.join("|")}>`);
    process.exit(2);
  }
  let ok = false;
  try {
    ok = job === "ingest" ? await ingest() : await ogCards();
  } catch (err) {
    console.log(
      JSON.stringify({ job, ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  }
  // The postgres pool keeps the event loop alive; exit explicitly.
  process.exit(ok ? 0 : 1);
}

void main();
