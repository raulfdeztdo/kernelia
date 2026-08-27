import OpenAI from "openai";

/**
 * Groq's OpenAI-compatible endpoint. Swapped in from Cerebras in
 * 2026-08 after Cerebras started answering `402 payment_required` to
 * every call (quota wall, both models on the key) and the feed stopped
 * moving for eight days.
 *
 * Groq serves the SAME open-weights model we were already running
 * (`gpt-oss-120b`), so the bilingual prompt, the Zod schema and the
 * Spanish quality are the ones already validated over 6.5k articles —
 * the migration carries no behavioural risk, only operational.
 */
export const LLM_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Groq namespaces the open models it hosts, so the id carries the
 * `openai/` prefix — `gpt-oss-120b` alone is a 404 here. Same weights
 * as the Cerebras model of the same name.
 */
export const LLM_DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * Per-request hard timeout for LLM calls. Groq's LPU hardware is in the
 * same latency class as Cerebras (sub-second median), but a throttled
 * tail call can still run long. Without this cap one tail eats the whole
 * Vercel 60s function budget and returns 504; with it, the SDK aborts at
 * 15s and `runClassify` keeps the article in `pending` (NOT marked
 * failed) so the next cron tick retries it.
 *
 * Override with LLM_TIMEOUT_MS if you need a different ceiling.
 */
export const LLM_DEFAULT_TIMEOUT_MS = 15_000;

let cachedClient: OpenAI | null = null;
let cachedKey: string | null = null;

/**
 * Reads the provider config from `LLM_*`, falling back to the legacy
 * `CEREBRAS_*` names.
 *
 * The fallback is deliberate and worth keeping: it lets the Groq
 * deploy go out BEFORE the Vercel env vars are renamed, so the rename
 * is never a flag-day. Drop the legacy branch once the dashboard only
 * has `LLM_*` — this is the second provider swap in a month, and the
 * next one shouldn't need a code change at all.
 */
function readProviderEnv() {
  return {
    apiKey: process.env.LLM_API_KEY ?? process.env.CEREBRAS_API_KEY,
    baseURL: process.env.LLM_BASE_URL ?? process.env.CEREBRAS_BASE_URL ?? LLM_DEFAULT_BASE_URL,
    timeoutRaw: process.env.LLM_TIMEOUT_MS ?? process.env.CEREBRAS_TIMEOUT_MS,
  };
}

export function getLlmClient(): OpenAI {
  const { apiKey, baseURL, timeoutRaw } = readProviderEnv();
  if (!apiKey) {
    throw new Error("LLM_API_KEY is not set (legacy CEREBRAS_API_KEY also accepted)");
  }
  const timeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : LLM_DEFAULT_TIMEOUT_MS;

  // Cache key must include timeout so an env tweak between dev runs
  // doesn't reuse a stale client. In production env vars are immutable
  // per deployment so this just future-proofs local iteration.
  const key = `${apiKey}|${baseURL}|${timeout}`;
  if (cachedClient && cachedKey === key) return cachedClient;

  // `maxRetries: 0` is non-negotiable for the classify cron. The SDK's
  // default is 2 retries with exponential backoff, which means a single
  // slow / throttled call can consume up to 3 × 15s = 45s of wall-clock
  // before the SDK gives up. With limit=6 and delayBetweenMs=3000 the
  // happy path already spends ~20s; ONE retrying article pushes the
  // function past Vercel's 60s cap → 504. The wall-clock budget in
  // `runClassify` only fires BETWEEN articles, so it can't preempt an
  // SDK retry loop already in flight.
  //
  // We have our own retry layer at the article level: any provider-side
  // failure (timeout, 429, 5xx, 402) leaves the row in `status='pending'`
  // and the next cron tick picks it up. Faster + cheaper than letting
  // the SDK spin on a known-bad call.
  cachedClient = new OpenAI({ apiKey, baseURL, timeout, maxRetries: 0 });
  cachedKey = key;
  return cachedClient;
}

export function getLlmModel(): string {
  return process.env.LLM_MODEL ?? process.env.CEREBRAS_MODEL ?? LLM_DEFAULT_MODEL;
}
