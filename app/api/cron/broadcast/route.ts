import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runBroadcast } from "@/lib/broadcast/run";
import { beginCronRun, broadcastStatus, endCronRun } from "@/lib/cron-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Same pattern as `/api/cron/classify`: enforce a wall-clock budget below
 * the platform cap so a slow HTTP call to one of the broadcast platforms
 * can't push the function past 60s and trigger a 504.
 *
 * 52s = 60 (maxDuration) − 8s of headroom for JSON response + cron_run
 * write + gateway ACK.
 */
const WALL_TIME_BUDGET_MS = (maxDuration - 8) * 1000;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // `?force=1` (sent by manual `workflow_dispatch` and by the admin
  // panel) bypasses the Europe/Madrid window check so admins can
  // publish on demand at any hour. Scheduled GitHub Actions ticks
  // never set this param, so the window is honoured automatically.
  const force = new URL(request.url).searchParams.get("force") === "1";

  const startedAt = new Date();
  // Pre-insert the `cron_runs` row in `status: 'running'` so the
  // broadcast inserts further down can stamp `article_broadcasts.cron_run_id`.
  // If this fails (`null`), the run still proceeds — it just loses
  // the FK and the admin detail view degrades gracefully.
  const cronRunId = await beginCronRun({ job: "broadcast", startedAt });
  try {
    const summary = await runBroadcast({
      maxWallTimeMs: WALL_TIME_BUDGET_MS,
      respectWindow: !force,
      cronRunId,
    });
    await endCronRun(
      {
        id: cronRunId,
        status: broadcastStatus(summary),
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      },
      "broadcast",
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
      "broadcast",
      startedAt,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
