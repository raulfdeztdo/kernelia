import { describe, expect, it } from "vitest";
import { AdminUserError } from "@/db/queries/admin-users";

/**
 * Pure-helper coverage. `adminAddUser`, `adminSetActive` and
 * `adminDeleteUserChecked` run SQL so the live guardrails (would-orphan,
 * self-target, duplicate-email) are exercised via manual smoke through the
 * route handlers. What CAN be locked down statically is the `AdminUserError`
 * envelope — the UI parses `{ error: code }` and translates each code to
 * Spanish copy in `components/admin/user-row-actions.tsx`. Break the codes
 * and that mapping silently regresses to a generic error.
 */
describe("AdminUserError", () => {
  it("carries a typed `code` and `name`", () => {
    const err = new AdminUserError("not_found");
    expect(err.code).toBe("not_found");
    expect(err.name).toBe("AdminUserError");
    expect(err).toBeInstanceOf(Error);
  });

  it("supports every guardrail code", () => {
    // If a new code is added, the UI in `user-row-actions.tsx` /
    // `add-user-form.tsx` must learn how to render it — this list is the
    // contract.
    const codes = [
      "self_target",
      "would_orphan",
      "duplicate_email",
      "not_found",
      "invalid_email",
    ] as const;
    for (const c of codes) {
      const err = new AdminUserError(c);
      expect(err.code).toBe(c);
    }
  });
});
