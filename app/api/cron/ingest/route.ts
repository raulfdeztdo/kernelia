import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runIngestJob } from "@/lib/ingest/job";

/**
 * Manual / fallback ingest. Since phase 9.D the 3-hourly tick runs on the
 * Hepha worker (`scripts/worker.ts ingest`) and costs no Vercel CPU; this
 * endpoint stays for `workflow_dispatch` and for when Hepha is down.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runIngestJob();
  return result.ok
    ? NextResponse.json(result.summary)
    : NextResponse.json({ error: result.error }, { status: 500 });
}

// Vercel cron sends GET; allow POST for manual triggers too.
export const POST = GET;
