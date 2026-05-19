import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getCronRunById } from "@/db/queries/cron-runs";
import { listArticlesByCronRun } from "@/db/queries/articles";
import { listBroadcastsByCronRun } from "@/db/queries/article-broadcasts";
import { listSendsByCronRun } from "@/db/queries/newsletter-sends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cron/[id]/details
 *
 * Lazy-loaded payload for the /admin/cron expand-row detail view.
 * Shape depends on the run's `job`:
 *
 *   - `ingest`     → `{ kind: 'articles', articles: CronRunArticle[] }`
 *                    Articles first inserted by this tick.
 *   - `classify`   → `{ kind: 'articles', articles: CronRunArticle[] }`
 *                    Articles whose status was updated by this tick
 *                    (classified, hidden as dup/non_ai, failed).
 *   - `broadcast`  → `{ kind: 'broadcasts', broadcasts: CronRunBroadcast[] }`
 *                    (article, platform) rows posted by this tick.
 *   - `newsletter` → `{ kind: 'newsletter_pending', summary: <existing> }`
 *                    Per-subscriber send rows ship in PR 4 (Phase 8.E).
 *                    For now the row's stored summary is the source of truth.
 *
 * Returns 404 for unknown ids, 401/403 for missing admin session.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await ctx.params;
  const run = await getCronRunById(id);
  if (!run) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (run.job === "ingest" || run.job === "classify") {
    const stage = run.job === "ingest" ? "ingested" : "classified";
    const articles = await listArticlesByCronRun(run.id, stage);
    return NextResponse.json({ kind: "articles", articles });
  }
  if (run.job === "broadcast") {
    const broadcasts = await listBroadcastsByCronRun(run.id);
    return NextResponse.json({ kind: "broadcasts", broadcasts });
  }
  if (run.job === "newsletter") {
    // List of per-subscriber sends with open status (Phase 8.E).
    const sends = await listSendsByCronRun(run.id);
    return NextResponse.json({ kind: "newsletter_sends", sends });
  }
  // cleanup: there are no surviving rows to list (they were just
  // deleted) — return the stored summary so the UI can show "N
  // articles purged, cutoff X" and a sample of ids the deleter saved
  // for debugging.
  return NextResponse.json({ kind: "cleanup_summary", summary: run.summary });
}
