import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runCleanup } from "@/lib/cleanup/run";
import { beginCronRun, endCronRun } from "@/lib/cron-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/cleanup
 *
 * Daily maintenance tick — hard-deletes failed/hidden articles older
 * than 7 days. Auth via `Authorization: Bearer ${CRON_SECRET}`,
 * triggered by `.github/workflows/cron.yml` at 04:00 UTC.
 *
 * Same cron_runs lifecycle as the other jobs (Phase 8.D): begin →
 * work → end. Cleanup is fast (one bulk DELETE, no LLM calls) so we
 * don't bother with a wall-clock budget.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const cronRunId = await beginCronRun({ job: "cleanup", startedAt });
  try {
    const summary = await runCleanup();
    await endCronRun(
      {
        id: cronRunId,
        status: "ok",
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      },
      "cleanup",
      startedAt,
    );
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await endCronRun(
      {
        id: cronRunId,
        status: "failed",
        finishedAt: new Date(),
        summary: { error: message },
        errorMessage: message,
      },
      "cleanup",
      startedAt,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
