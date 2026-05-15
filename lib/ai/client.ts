import OpenAI from "openai";

export const CEREBRAS_DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";
export const CEREBRAS_DEFAULT_MODEL = "llama3.1-8b";

/**
 * Per-request hard timeout for LLM calls. Cerebras' median latency is
 * ~400ms and P95 is ~2s, but the free tier exhibits rare TPM-throttle
 * tails of 50-56s — observed empirically in the A/B run. Without this
 * cap a single tail call eats the whole Vercel 60s function budget and
 * returns 504; with it, the SDK aborts at 15s and `runClassify` keeps
 * the article in `pending` (NOT marked failed) so the next cron tick
 * retries it. 15s is generous enough that all non-pathological calls
 * succeed.
 *
 * Override with CEREBRAS_TIMEOUT_MS if you need a different ceiling
 * (e.g. local debugging against a slow proxy).
 */
export const CEREBRAS_DEFAULT_TIMEOUT_MS = 15_000;

let cachedClient: OpenAI | null = null;
let cachedKey: string | null = null;

export function getCerebrasClient(): OpenAI {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error("CEREBRAS_API_KEY is not set");
  }
  const baseURL = process.env.CEREBRAS_BASE_URL ?? CEREBRAS_DEFAULT_BASE_URL;
  const timeout = process.env.CEREBRAS_TIMEOUT_MS
    ? Number.parseInt(process.env.CEREBRAS_TIMEOUT_MS, 10)
    : CEREBRAS_DEFAULT_TIMEOUT_MS;

  // Cache key must include timeout so an env tweak between dev runs
  // doesn't reuse a stale client. In production env vars are immutable
  // per deployment so this just future-proofs local iteration.
  const key = `${apiKey}|${baseURL}|${timeout}`;
  if (cachedClient && cachedKey === key) return cachedClient;

  cachedClient = new OpenAI({ apiKey, baseURL, timeout });
  cachedKey = key;
  return cachedClient;
}

export function getCerebrasModel(): string {
  return process.env.CEREBRAS_MODEL ?? CEREBRAS_DEFAULT_MODEL;
}
