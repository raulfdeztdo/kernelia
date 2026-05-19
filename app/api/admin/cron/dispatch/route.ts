import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  CronDispatchConfigError,
  CRON_DISPATCH_JOBS,
  dispatchCronWorkflow,
} from "@/lib/github/dispatch";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("admin_cron_dispatch");

const bodySchema = z.object({
  job: z.enum(CRON_DISPATCH_JOBS),
});

/**
 * POST /api/admin/cron/dispatch
 *
 * Body: `{ job: 'ingest' | 'classify' | 'broadcast' | 'newsletter' }`.
 *
 * Returns:
 * - 200 `{ ok: true, runsUrl }` — GitHub accepted the dispatch.
 * - 400 `{ error: 'invalid_body' }`.
 * - 401 / 403 — no/invalid admin session.
 * - 500 `{ error: 'config', missingEnv }` — `GH_DISPATCH_TOKEN` or
 *   `GITHUB_REPO_SLUG` not set in Vercel. The UI surfaces this so the
 *   operator knows what to add without touching logs.
 * - 502 `{ error: 'github', status, message }` — GitHub answered with a
 *   non-204. Usually a stale token, scope missing, or `workflow_dispatch`
 *   not yet propagated for a freshly-pushed workflow.
 *
 * We log the admin email + job at the route handler so a misuse is easy
 * to trace; the GitHub call itself logs in `lib/github/dispatch.ts`.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { job } = parsed.data;

  try {
    const result = await dispatchCronWorkflow(job);
    if (!result.ok) {
      // Try to lift a human-readable reason out of GitHub's response.
      // The dispatch endpoint usually returns `{ message: "...", errors: [...] }`.
      let message = `HTTP ${result.status}`;
      try {
        const body = JSON.parse(result.errorBody ?? "") as { message?: string };
        if (typeof body.message === "string") message = body.message;
      } catch {
        /* not JSON — keep the HTTP fallback */
      }
      log.warn("dispatch_rejected", {
        job,
        admin: auth.user.email,
        status: result.status,
      });
      return NextResponse.json(
        { error: "github", status: result.status, message },
        { status: 502 },
      );
    }
    log.info("dispatch_ok", { job, admin: auth.user.email });
    return NextResponse.json({ ok: true, runsUrl: result.runsUrl });
  } catch (err) {
    if (err instanceof CronDispatchConfigError) {
      log.error("config_missing", { missingEnv: err.missingEnv });
      return NextResponse.json(
        { error: "config", missingEnv: err.missingEnv },
        { status: 500 },
      );
    }
    throw err;
  }
}
