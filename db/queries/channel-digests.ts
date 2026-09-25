import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelDigests, type BroadcastPlatform, type DigestSlot } from "@/db/schema";

/**
 * The only DB surface for `channel_digests` (Phase 9.C). The unique index
 * on (platform, digest_date, slot) turns `claimDigestSlot` into a lock:
 * whoever inserts the row owns the slot.
 */

/** A claim that never got its `sent_at` after this long belongs to a dead tick. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface ClaimDigestParams {
  platform: BroadcastPlatform;
  digestDate: string;
  slot: DigestSlot;
  cronRunId?: string | null;
  now?: Date;
}

/**
 * Tries to take the slot. Returns the claim id, or `null` when the slot is
 * already sent or being sent by another tick.
 *
 * A claim left unsent for longer than `STALE_CLAIM_MS` (the function died
 * between claiming and sending) is dropped first, so a crash costs one
 * tick, not the whole slot.
 */
export async function claimDigestSlot(params: ClaimDigestParams): Promise<string | null> {
  const now = params.now ?? new Date();
  await db
    .delete(channelDigests)
    .where(
      and(
        eq(channelDigests.platform, params.platform),
        eq(channelDigests.digestDate, params.digestDate),
        eq(channelDigests.slot, params.slot),
        isNull(channelDigests.sentAt),
        lt(channelDigests.createdAt, new Date(now.getTime() - STALE_CLAIM_MS)),
      ),
    );
  const rows = await db
    .insert(channelDigests)
    .values({
      platform: params.platform,
      digestDate: params.digestDate,
      slot: params.slot,
      cronRunId: params.cronRunId ?? null,
    })
    .onConflictDoNothing({
      target: [channelDigests.platform, channelDigests.digestDate, channelDigests.slot],
    })
    .returning({ id: channelDigests.id });
  return rows[0]?.id ?? null;
}

/** Gives the slot back (nothing to send, or the send failed). Never touches a sent row. */
export async function releaseDigestClaim(id: string): Promise<void> {
  await db
    .delete(channelDigests)
    .where(and(eq(channelDigests.id, id), isNull(channelDigests.sentAt)));
}

export async function markDigestSent(params: {
  id: string;
  externalId: string;
  articleIds: string[];
}): Promise<void> {
  await db
    .update(channelDigests)
    .set({
      externalId: params.externalId,
      articleIds: params.articleIds,
      sentAt: sql`now()`,
    })
    .where(eq(channelDigests.id, params.id));
}
