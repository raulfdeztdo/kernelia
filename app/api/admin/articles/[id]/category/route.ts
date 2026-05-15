import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adminSetArticleCategory,
  readAdminArticleSnapshot,
} from "@/db/queries/admin-articles";
import { getCategoryMap } from "@/db/queries/categories";
import { requireAdmin } from "@/lib/auth/require-admin";
import { auditAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // `null` allowed: some pending articles never received a category.
  categoryId: z.string().uuid().nullable(),
});

/**
 * POST /api/admin/articles/[id]/category
 *
 * Reassigns the category of a single article. Validates that the new
 * `categoryId` (if non-null) is one of the existing 10 catalog rows —
 * admins cannot invent new slugs from the UI (that's a prompt-affecting
 * change, scoped out of Phase 7).
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

  if (parsed.data.categoryId !== null) {
    // Cheap O(10) lookup. The map is cached process-wide so this is free
    // after the first call.
    const catMap = await getCategoryMap();
    const exists = [...catMap.values()].includes(parsed.data.categoryId);
    if (!exists) {
      return NextResponse.json({ error: "unknown_category" }, { status: 422 });
    }
  }

  await adminSetArticleCategory(id, parsed.data.categoryId);

  auditAdminAction({
    adminEmail: auth.user.email,
    adminUserId: auth.user.id,
    entity: "article",
    entityId: id,
    action: "set_category",
    diff: { categoryId: { from: before.categoryId, to: parsed.data.categoryId } },
  });

  return NextResponse.json({ ok: true });
}
