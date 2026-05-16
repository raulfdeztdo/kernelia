import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminUserError,
  adminDeleteUserChecked,
  adminSetActive,
} from "@/db/queries/admin-users";
import { getUserById } from "@/db/queries/users";
import { requireAdmin } from "@/lib/auth/require-admin";
import { auditAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  active: z.boolean(),
});

/**
 * Shared error mapping for both PATCH and DELETE. Keeps the envelope stable
 * — the client island parses `{error}` and shows a single inline message.
 */
function mapAdminUserError(err: AdminUserError): Response {
  const code = err.code;
  // self_target and would_orphan both deserve 409 (Conflict) — the request
  // is syntactically valid but rejected by a server-side rule. not_found
  // is the standard 404.
  if (code === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (code === "self_target" || code === "would_orphan") {
    return NextResponse.json({ error: code }, { status: 409 });
  }
  return NextResponse.json({ error: code }, { status: 400 });
}

/**
 * PATCH /api/admin/users/[id]
 *
 * Body: `{ active: boolean }`. Reactivates or deactivates a user.
 * Deactivating drops their sessions immediately (via `setUserActive`).
 *
 * Guardrails: cannot target your own user; cannot leave zero active admins.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const before = await getUserById(id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const updated = await adminSetActive({
      targetId: id,
      callerId: auth.user.id,
      active: parsed.data.active,
    });
    auditAdminAction({
      adminEmail: auth.user.email,
      adminUserId: auth.user.id,
      entity: "user",
      entityId: id,
      action: parsed.data.active ? "reactivate_user" : "deactivate_user",
      diff: { active: { from: before.active, to: updated.active } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminUserError) return mapAdminUserError(err);
    throw err;
  }
}

/**
 * DELETE /api/admin/users/[id]
 *
 * Permanently removes a user. FK cascade drops their sessions and any
 * outstanding password-reset tokens. Same guardrails as PATCH.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const before = await getUserById(id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await adminDeleteUserChecked({ targetId: id, callerId: auth.user.id });
    auditAdminAction({
      adminEmail: auth.user.email,
      adminUserId: auth.user.id,
      entity: "user",
      entityId: id,
      action: "delete_user",
      diff: { email: { from: before.email, to: null } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminUserError) return mapAdminUserError(err);
    throw err;
  }
}
