import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { DIGEST_SLOT_WINDOW, getDueSlot, runDigest } from "@/lib/broadcast/digest";
import { getMadridHour } from "@/lib/broadcast/window";
import { beginCronRun, digestStatus, endCronRun } from "@/lib/cron-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/digest — Telegram digest tick (Phase 9.C).
 *
 * Called hourly (Hepha at :10, GitHub Actions as backup); the handler
 * decides whether the 08:00 or 17:00 Madrid slot is due. Calling it more
 * often, or from two schedulers at once, is safe: each slot is claimed
 * in `channel_digests` before anything is sent.
 *
 * `?force=1` (manual dispatch) sends even outside the slot windows: before
 * 13:00 Madrid it means "morning", after it "afternoon". It does NOT
 * bypass the per-slot lock: a slot that already went out is never sent
 * twice.
 *
 * A tick with no slot due returns early without writing a `cron_runs`
 * row, so /admin/cron only shows the ticks that actually did something.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";
  const startedAt = new Date();
  const dueSlot = getDueSlot(startedAt);
  if (!dueSlot && !force) {
    return NextResponse.json({ outcome: "not_due" });
  }

  const cronRunId = await beginCronRun({ job: "digest", startedAt });
  try {
    const summary = await runDigest({
      forceSlot: force
        ? (dueSlot ??
          (getMadridHour(startedAt) < DIGEST_SLOT_WINDOW.morning.until ? "morning" : "afternoon"))
        : undefined,
      cronRunId,
    });
    await endCronRun(
      {
        id: cronRunId,
        status: digestStatus(summary),
        finishedAt: new Date(),
        summary: { ...summary },
        errorMessage: summary.outcome === "failed" ? summary.error : null,
      },
      "digest",
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
      "digest",
      startedAt,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
