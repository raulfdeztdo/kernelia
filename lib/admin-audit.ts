import { createLogger } from "@/lib/logger";

/**
 * Structured audit log for admin mutations. V1 of Phase 7 does NOT have a
 * dedicated `audit_events` table — the operator is the single admin, so
 * `console.log` shipped to Vercel's runtime logs is enough to reconstruct
 * what happened. If a second user signs up via 7.E, a dedicated table is
 * the natural follow-up.
 *
 * Every mutation in `/api/admin/*` calls `auditAdminAction` immediately
 * after the DB write succeeds. Fields are kept narrow (id + action + diff)
 * so logs stay grep-able and cheap.
 */

const log = createLogger("admin_audit");

export interface AdminAuditEvent {
  adminEmail: string;
  adminUserId: string;
  /** What was acted on (e.g. "article", "user"). */
  entity: "article" | "user";
  entityId: string;
  /** Verb. Keep short and stable. */
  action: string;
  /** Optional `{ key: { from, to } }` snapshot, narrow on purpose. */
  diff?: Record<string, { from: unknown; to: unknown }>;
}

export function auditAdminAction(event: AdminAuditEvent): void {
  log.info("admin_action", {
    adminEmail: event.adminEmail,
    adminUserId: event.adminUserId,
    entity: event.entity,
    entityId: event.entityId,
    action: event.action,
    diff: event.diff ?? null,
  });
}
