/**
 * Thin wrapper around GitHub's `POST /repos/{owner}/{repo}/actions/
 * workflows/{workflow_id}/dispatches` endpoint. Used by the admin panel
 * to trigger the four scheduled crons (`ingest`, `classify`, `broadcast`,
 * `newsletter`) on demand, without leaving the dashboard.
 *
 * The workflow file (`cron.yml`) already declares `workflow_dispatch`
 * with a `job` input that selects which step runs, so a single
 * dispatch call covers all four crons.
 *
 * Required environment variables:
 *   - `GH_DISPATCH_TOKEN`: GitHub PAT with `workflow` scope (classic)
 *     or fine-grained with `actions: write` on the repo.
 *   - `GITHUB_REPO_SLUG`: e.g. `raulfdeztdo/kernelia`.
 *
 * The token is private to the server runtime — never exposed to the
 * client. The admin route handler that calls this gates on session.
 */

import { createLogger } from "@/lib/logger";

export type CronDispatchJob =
  | "ingest"
  | "classify"
  | "broadcast"
  | "newsletter"
  | "cleanup";

export const CRON_DISPATCH_JOBS = [
  "ingest",
  "classify",
  "broadcast",
  "newsletter",
  "cleanup",
] as const satisfies readonly CronDispatchJob[];

const WORKFLOW_FILE = "cron.yml";
const REF = "main";

const log = createLogger("github_dispatch");

export interface DispatchResult {
  ok: boolean;
  /** Best-effort link to the Actions run list filtered by the workflow. */
  runsUrl: string | null;
  /** GitHub returns 204 on success; anything else lives here. */
  status: number;
  /** Body when GitHub answers with an error (`{ message, errors }` typically). */
  errorBody?: string;
}

export class CronDispatchConfigError extends Error {
  constructor(public readonly missingEnv: string) {
    super(`missing_env:${missingEnv}`);
    this.name = "CronDispatchConfigError";
  }
}

/**
 * Triggers the `cron.yml` workflow on `main` with the chosen job. Returns
 * `{ ok: true, runsUrl }` on success (HTTP 204 from GitHub). Wraps the
 * error response in a structured object on failure so the route handler
 * can surface a useful message to the admin without leaking the token.
 *
 * Throws `CronDispatchConfigError` only when the server is misconfigured
 * (missing env var); never throws on a normal GitHub 4xx response.
 */
export async function dispatchCronWorkflow(job: CronDispatchJob): Promise<DispatchResult> {
  const token = process.env.GH_DISPATCH_TOKEN;
  const slug = process.env.GITHUB_REPO_SLUG;
  if (!token) throw new CronDispatchConfigError("GH_DISPATCH_TOKEN");
  if (!slug) throw new CronDispatchConfigError("GITHUB_REPO_SLUG");

  const url = `https://api.github.com/repos/${slug}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kernelia-admin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: REF, inputs: { job } }),
    // Never cache: this is a side-effect call, and GitHub returns 204
    // with no body anyway.
    cache: "no-store",
  });

  // GitHub's dispatch endpoint always returns 204 No Content on success.
  // Anything else is an error; capture the body for the admin UI.
  const runsUrl = `https://github.com/${slug}/actions/workflows/${WORKFLOW_FILE}`;
  if (res.status === 204) {
    log.info("dispatch_ok", { job, slug });
    return { ok: true, runsUrl, status: 204 };
  }

  const errorBody = await res.text().catch(() => "");
  log.warn("dispatch_failed", { job, slug, status: res.status, body: errorBody.slice(0, 300) });
  return { ok: false, runsUrl, status: res.status, errorBody };
}
