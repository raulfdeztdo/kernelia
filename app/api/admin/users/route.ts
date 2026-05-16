import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminUserError, adminAddUser } from "@/db/queries/admin-users";
import { requireAdmin } from "@/lib/auth/require-admin";
import { auditAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().min(1).max(320),
});

/**
 * POST /api/admin/users
 *
 * Body: `{ email }`. Adds a new admin user (active by default). No invite
 * email is sent — the user goes to `/admin/login`, clicks "forgot password",
 * receives the reset link via Resend and chooses their first password.
 *
 * Responses:
 * - 200 `{ ok: true, id }` on success.
 * - 400 `{ error: 'invalid_body' | 'invalid_email' }`.
 * - 401 unauthorized; 403 forbidden (non-admin session).
 * - 409 `{ error: 'duplicate_email' }`.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const created = await adminAddUser({ email: parsed.data.email });
    auditAdminAction({
      adminEmail: auth.user.email,
      adminUserId: auth.user.id,
      entity: "user",
      entityId: created.id,
      action: "add_user",
      diff: { email: { from: null, to: created.email } },
    });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    if (err instanceof AdminUserError) {
      if (err.code === "invalid_email") {
        return NextResponse.json({ error: "invalid_email" }, { status: 400 });
      }
      if (err.code === "duplicate_email") {
        return NextResponse.json({ error: "duplicate_email" }, { status: 409 });
      }
    }
    throw err;
  }
}
