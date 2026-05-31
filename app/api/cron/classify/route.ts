import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runClassify, DEFAULT_BATCH_SIZE } from "@/lib/ai/run";
import { beginCronRun, classifyStatus, endCronRun } from "@/lib/cron-logging";

// Cerebras free tier ~30 RPM on gpt-oss-120b but TPM cap kicks in earlier;
// 3s gap (~20 RPM) holds steady even when several batches run within a minute.
const DEFAULT_DELAY_BETWEEN_MS = 3000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Leave 8s of headroom under the Vercel cap for the JSON response
// to flush and the gateway to ACK. Without this margin a slow tail
// LLM call pushes the function past 60s → 504 → curl --retry 2
// triples the Cerebras load and the next franja also fails.
const WALL_TIME_BUDGET_MS = (maxDuration - 8) * 1000;

const MAX_LIMIT = 50;

function parseLimit(request: Request): number {
  const url = new URL(request.url);
  const raw = url.searchParams.get("limit");
  if (!raw) return DEFAULT_BATCH_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_LIMIT);
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  // Phase 8.D: pre-create the cron_run row so classify writes can
  // stamp `articles.classified_in_run`. Best-effort — null on failure.
  const cronRunId = await beginCronRun({ job: "classify", startedAt });
  try {
    const summary = await runClassify({
      limit: parseLimit(request),
      delayBetweenMs: DEFAULT_DELAY_BETWEEN_MS,
      maxWallTimeMs: WALL_TIME_BUDGET_MS,
      cronRunId,
    });
    await endCronRun(
      {
        id: cronRunId,
        status: classifyStatus(summary),
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      },
      "classify",
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
      "classify",
      startedAt,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
