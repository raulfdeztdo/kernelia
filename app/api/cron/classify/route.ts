import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/auth/cron";
import { runClassify, DEFAULT_BATCH_SIZE } from "@/lib/ai/run";
import { beginCronRun, classifyStatus, endCronRun } from "@/lib/cron-logging";

// Groq free tier on gpt-oss-120b: 30 RPM, 8K TPM, 1K RPD, 200K TPD
// (confirmed live via the `x-ratelimit-limit-*` response headers).
// RPM is not the binding limit — TPM is, and the batch size is what
// holds the burst under it.
//
// Measured on Groq against REAL feed rows, not synthetic samples:
//   English AI articles (short excerpts) ~1,600 tok/article
//   Hipertextual rows (long ES excerpts) ~2,116 tok/article
// Sizing against the worst source mix, not the mean: a tick that pulls
// 4 Hipertextual rows costs ~8.5K and 429s, so the ceiling is 3
// (~6.3K/min = 79% of the cap). limit=6 was tried first and 429'd for
// real — the error is in this repo's history, not a hypothesis.
//
// Do NOT raise this without re-measuring. The 1,193 tok/article figure
// that circulated earlier came from llama3.1-8b, a model we no longer
// run; gpt-oss-120b spends far more on completion. Capacity at 3/tick
// × 48 ticks = 144 articles/day, still ~2x the busiest day this feed
// has ever ingested. Throughput is not the constraint here.
const DEFAULT_DELAY_BETWEEN_MS = 3000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Leave 8s of headroom under the Vercel cap for the JSON response
// to flush and the gateway to ACK. Without this margin a slow tail
// LLM call pushes the function past 60s → 504 → curl --retry 2
// triples the load on the provider and the next franja also fails.
const WALL_TIME_BUDGET_MS = (maxDuration - 8) * 1000;

// Ceiling for a manual `?limit=` override. Kept low on purpose: at
// ~1.2K tokens/article anything above ~6 exceeds Groq's 8K TPM within
// the burst minute and 429s partway through the batch. Raising this
// only makes sense alongside a paid tier or a longer delay.
const MAX_LIMIT = 12;

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
        // Surface a provider-wide outage (402 quota, 401 key, 404 model,
        // sustained 429/5xx) as the run's error so /admin shows *why*
        // nothing got classified instead of a silent empty tick.
        errorMessage: summary.providerOutage
          ? `LLM provider outage: ${summary.providerOutage}`
          : undefined,
      },
      "classify",
      startedAt,
    );
    // Deliberately still HTTP 200: the handler itself did its job and the
    // articles are safely `pending`. Returning 5xx here would make the
    // workflow's `curl --retry` hammer a provider we already know is
    // refusing every call.
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
