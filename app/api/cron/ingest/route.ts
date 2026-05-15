import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runIngest } from "@/lib/ingest/run";
import { ingestStatus, logCronRun } from "@/lib/cron-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    const summary = await runIngest();
    await logCronRun({
      job: "ingest",
      status: ingestStatus(summary.totals),
      startedAt,
      finishedAt: new Date(),
      summary: summary as unknown as Record<string, unknown>,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun({
      job: "ingest",
      status: "failed",
      startedAt,
      finishedAt: new Date(),
      summary: { error: message },
      errorMessage: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel cron sends GET; allow POST for manual triggers too.
export const POST = GET;
