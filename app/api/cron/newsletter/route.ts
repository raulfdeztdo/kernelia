import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { newsletterStatus, runNewsletter } from "@/lib/newsletter/run";
import { logCronRun } from "@/lib/cron-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Same pattern as the broadcast cron: enforce a wall-clock budget below the
 * platform cap so a long subscriber list (or a slow Resend response) can't
 * push the function past 60s and trigger a 504.
 *
 * 52s = 60 (maxDuration) − 8s headroom for JSON response + cron_run write
 * + gateway ACK.
 */
const WALL_TIME_BUDGET_MS = (maxDuration - 8) * 1000;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    const summary = await runNewsletter({ maxWallTimeMs: WALL_TIME_BUDGET_MS });
    await logCronRun({
      job: "newsletter",
      status: newsletterStatus(summary),
      startedAt,
      finishedAt: new Date(),
      summary: summary as unknown as Record<string, unknown>,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCronRun({
      job: "newsletter",
      status: "failed",
      startedAt,
      finishedAt: new Date(),
      summary: { error: message },
      errorMessage: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
