import {
  countActiveAdmins,
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  normaliseEmail,
  setUserActive,
  type User,
} from "@/db/queries/users";

/**
 * Admin-orchestration layer over `db/queries/users`. The plain `users` helpers
 * are dumb CRUD — they happily let you delete the last admin or deactivate
 * yourself. This layer wraps them with the guardrails required by 7.E so the
 * route handlers stay thin and the error envelope is shared:
 *
 * - **self_target**: the caller is acting on their own row. Logging yourself
 *   out by deactivating your own session is fine in theory, but in practice
 *   the operator does it by accident and locks themselves out. We forbid it
 *   server-side; the UI hides the controls too as defense in depth.
 * - **would_orphan**: the operation would leave the system with zero active
 *   admin users. If that happens nobody can log back in (the login route
 *   only accepts active users, and even "forgot password" requires an
 *   active row). Recovery would mean running a manual SQL
 *   `update users set active = true`.
 * - **duplicate_email**: someone already has this address.
 * - **not_found**: the target id doesn't match any row.
 *
 * The route handler maps each code to an HTTP status; see `AdminUserError`
 * below for the canonical mapping.
 */

export type AdminUserErrorCode =
  | "self_target"
  | "would_orphan"
  | "duplicate_email"
  | "not_found"
  | "invalid_email";

export class AdminUserError extends Error {
  readonly code: AdminUserErrorCode;
  constructor(code: AdminUserErrorCode) {
    super(`admin user error: ${code}`);
    this.name = "AdminUserError";
    this.code = code;
  }
}

// RFC-5322-ish — same shape as the email validation in
// `lib/auth/forgot-password-flow.ts`. Kept inline to avoid coupling this
// module to the password flow.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AdminAddUserParams {
  email: string;
}

/**
 * Create a new admin user. Idempotent-ish: if the email already exists,
 * throws `AdminUserError('duplicate_email')` so the caller can render a
 * clear "ya existe" message rather than a generic 500.
 */
export async function adminAddUser(params: AdminAddUserParams): Promise<User> {
  const email = normaliseEmail(params.email);
  if (!EMAIL_RE.test(email)) {
    throw new AdminUserError("invalid_email");
  }
  const existing = await getUserByEmail(email);
  if (existing) {
    throw new AdminUserError("duplicate_email");
  }
  return createUser({ email, userType: "admin" });
}

export interface AdminMutateUserParams {
  /** Target user id. */
  targetId: string;
  /** Authenticated admin's id (used for self-target guard). */
  callerId: string;
}

export interface AdminSetActiveParams extends AdminMutateUserParams {
  active: boolean;
}

/**
 * Activate/deactivate a user. Deactivating drops all their sessions via the
 * underlying `setUserActive` (see `db/queries/users.ts`).
 *
 * Guardrails:
 * - self_target if `targetId === callerId` (UI hides controls but we double-check).
 * - would_orphan if turning `active=false` would leave zero active admins.
 */
export async function adminSetActive(params: AdminSetActiveParams): Promise<User> {
  if (params.targetId === params.callerId) {
    throw new AdminUserError("self_target");
  }
  const target = await getUserById(params.targetId);
  if (!target) {
    throw new AdminUserError("not_found");
  }
  if (!params.active && target.active && target.userType === "admin") {
    // Excluding the target from the count: how many active admins remain if
    // we go through with the deactivation? Must be >= 1.
    const remaining = await countActiveAdmins({ excludeUserId: params.targetId });
    if (remaining === 0) {
      throw new AdminUserError("would_orphan");
    }
  }
  const updated = await setUserActive(params.targetId, params.active);
  if (!updated) {
    // Lost the row in between the read and the write — extremely unlikely
    // (single-operator system) but report it cleanly.
    throw new AdminUserError("not_found");
  }
  return updated;
}

/**
 * Delete a user permanently. Same guardrails as deactivate; deleting an
 * active admin requires at least one other active admin to remain.
 *
 * Sessions are cleaned up via the FK ON DELETE CASCADE on `sessions.user_id`
 * (see migration), so we don't need to wipe them here explicitly.
 */
export async function adminDeleteUserChecked(params: AdminMutateUserParams): Promise<void> {
  if (params.targetId === params.callerId) {
    throw new AdminUserError("self_target");
  }
  const target = await getUserById(params.targetId);
  if (!target) {
    throw new AdminUserError("not_found");
  }
  if (target.active && target.userType === "admin") {
    const remaining = await countActiveAdmins({ excludeUserId: params.targetId });
    if (remaining === 0) {
      throw new AdminUserError("would_orphan");
    }
  }
  const ok = await deleteUser(params.targetId);
  if (!ok) {
    throw new AdminUserError("not_found");
  }
}
