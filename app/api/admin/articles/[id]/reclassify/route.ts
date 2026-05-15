import { NextResponse } from "next/server";
import {
  adminReclassifyArticle,
  readAdminArticleSnapshot,
} from "@/db/queries/admin-articles";
import { requireAdmin } from "@/lib/auth/require-admin";
import { auditAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/articles/[id]/reclassify
 *
 * Convenience shortcut: drop the article back to `pending` and clear the
 * stored classification error. The next cron tick will re-pick it via
 * `listPendingArticles`. Equivalent to setting status='pending' through
 * the status endpoint, but exposed as a distinct verb so the UI can
 * surface it as a one-click action with no dropdown.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const before = await readAdminArticleSnapshot(id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await adminReclassifyArticle(id);

  auditAdminAction({
    adminEmail: auth.user.email,
    adminUserId: auth.user.id,
    entity: "article",
    entityId: id,
    action: "reclassify",
    diff: { status: { from: before.status, to: "pending" } },
  });

  return NextResponse.json({ ok: true });
}
