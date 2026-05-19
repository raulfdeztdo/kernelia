import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runIngest } from "@/lib/ingest/run";
import { beginCronRun, endCronRun, ingestStatus } from "@/lib/cron-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  // Phase 8.D: pre-create cron_runs row so insertPendingArticles can
  // stamp `articles.ingested_in_run`. Best-effort — null on failure.
  const cronRunId = await beginCronRun({ job: "ingest", startedAt });
  try {
    const summary = await runIngest({ cronRunId });
    await endCronRun(
      {
        id: cronRunId,
        status: ingestStatus(summary.totals),
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      },
      "ingest",
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
      "ingest",
      startedAt,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel cron sends GET; allow POST for manual triggers too.
export const POST = GET;
