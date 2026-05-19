import { NextResponse } from "next/server";
import { updatePreferredCategoriesByToken } from "@/db/queries/newsletter";
import { subscribePreferredCategoriesSchema } from "@/lib/newsletter/subscribe-flow";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("newsletter_preferences");

/**
 * POST /api/newsletter/preferences
 *
 * Mutating endpoint — only reachable via form submission from the
 * `/[locale]/newsletter/preferences?token=…` page. Body shape:
 *   - `token`: the plaintext unsubscribe token from the digest email.
 *     We reuse the unsubscribe token rather than minting a separate
 *     "preferences token" so old digest links keep working and the
 *     subscriber doesn't need a second long-lived secret.
 *   - `preferredCategories`: zero-or-more form-encoded slug values, or
 *     a JSON array of slugs. Validated with the same schema the
 *     subscribe flow uses.
 *   - `lang`: locale of the landing page to redirect to (es/en).
 *
 * POST-only for the same reason as unsubscribe: email scanners pre-fetch
 * GET URLs and we don't want a scanner to flip a subscriber's
 * preferences. The page itself renders a real form.
 *
 * No oracle: a token miss redirects to the same `?saved=invalid`
 * query as a confirmed miss inside the DB layer (only active rows
 * match — see `updatePreferredCategoriesByToken`). A confirmed hit
 * redirects to `?saved=1`. Both render under the same page.
 */
export async function POST(req: Request): Promise<Response> {
  const { token, lang, rawPreferredCategories } = await readBody(req);
  const origin = pickOrigin(req);
  const langPrefix = lang === "en" ? "/en" : "";

  if (!token) {
    return redirect(`${langPrefix}/newsletter/preferences?saved=invalid`, origin);
  }

  const parsed = subscribePreferredCategoriesSchema.safeParse(rawPreferredCategories ?? []);
  // A fully-malformed payload (e.g. an object) becomes []. Per-item
  // junk is dropped silently by the schema's transform; we never
  // 400 a preferences POST.
  const preferredCategories = parsed.success ? parsed.data : [];

  // NextResponse.redirect() returns a Response — it does NOT throw.
  // React Review's nextjs-no-redirect-in-try-catch fires here as a
  // false positive because it can't distinguish `NextResponse.redirect`
  // (safe, returns a value) from `next/navigation`'s `redirect()` (which
  // throws a NEXT_REDIRECT error that try/catch would swallow).
  /* eslint-disable react-review/nextjs-no-redirect-in-try-catch */
  try {
    const row = await updatePreferredCategoriesByToken(token, preferredCategories);
    if (row) {
      log.info("preferences_updated", {
        subscriberId: row.id,
        count: preferredCategories.length,
      });
      // Echo the token back so the page re-renders with the updated
      // checkboxes pre-ticked. The token IS the page handle.
      return redirect(
        `${langPrefix}/newsletter/preferences?token=${encodeURIComponent(token)}&saved=1`,
        origin,
      );
    }
    log.info("preferences_token_miss");
    return redirect(`${langPrefix}/newsletter/preferences?saved=invalid`, origin);
  } catch (err) {
    log.error("preferences_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return redirect(
      `${langPrefix}/newsletter/preferences?token=${encodeURIComponent(token)}&saved=error`,
      origin,
    );
  }
  /* eslint-enable react-review/nextjs-no-redirect-in-try-catch */
}

async function readBody(req: Request): Promise<{
  token: string;
  lang: string | null;
  rawPreferredCategories: unknown;
}> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      return {
        token: typeof body.token === "string" ? body.token : "",
        lang: typeof body.lang === "string" ? body.lang : null,
        rawPreferredCategories: body.preferredCategories,
      };
    } catch {
      return { token: "", lang: null, rawPreferredCategories: undefined };
    }
  }
  try {
    const form = await req.formData();
    const token = form.get("token");
    const lang = form.get("lang");
    const preferredCategories = form
      .getAll("preferredCategories")
      .filter((v): v is string => typeof v === "string");
    return {
      token: typeof token === "string" ? token : "",
      lang: typeof lang === "string" ? lang : null,
      rawPreferredCategories: preferredCategories,
    };
  } catch {
    return { token: "", lang: null, rawPreferredCategories: undefined };
  }
}

function pickOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

function redirect(path: string, origin: string): Response {
  return NextResponse.redirect(new URL(path, origin), { status: 303 });
}
