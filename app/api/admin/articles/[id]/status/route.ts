import { NextResponse } from "next/server";
import { z } from "zod";
import { articleStatusEnum } from "@/db/schema";
import {
  AdminStatusError,
  adminSetArticleStatus,
  readAdminArticleSnapshot,
} from "@/db/queries/admin-articles";
import { requireAdmin } from "@/lib/auth/require-admin";
import { auditAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  status: z.enum(articleStatusEnum.enumValues),
});

/**
 * POST /api/admin/articles/[id]/status
 *
 * Body: `{ status: 'pending' | 'classified' | 'failed' | 'hidden' }`.
 *
 * Returns:
 * - 200 `{ ok: true }` on success
 * - 401 `{ error: 'unauthorized' }` if no session
 * - 404 `{ error: 'not_found' }` if the article id doesn't exist
 * - 422 `{ error: 'missing_columns', missingColumns: string[] }` if asked
 *   to set `classified` without the 5 columns populated. The UI shows
 *   the list to the operator so they know which fields to fill via a
 *   re-classify cycle.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const before = await readAdminArticleSnapshot(id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await adminSetArticleStatus(id, parsed.data.status);
  } catch (err) {
    if (err instanceof AdminStatusError) {
      if (err.code === "not_found") {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (err.code === "missing_columns") {
        return NextResponse.json(
          { error: "missing_columns", missingColumns: err.missingColumns ?? [] },
          { status: 422 },
        );
      }
    }
    throw err;
  }

  auditAdminAction({
    adminEmail: auth.user.email,
    adminUserId: auth.user.id,
    entity: "article",
    entityId: id,
    action: "set_status",
    diff: { status: { from: before.status, to: parsed.data.status } },
  });

  return NextResponse.json({ ok: true });
}
