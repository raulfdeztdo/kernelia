import { createHash } from "node:crypto";
import { canonicalizeUrl } from "./normalize";

/**
 * Deterministic hash of the canonicalized URL.
 * Used as a unique key in the articles table for dedupe.
 */
export function urlHash(url: string): string {
  return createHash("sha256").update(canonicalizeUrl(url)).digest("hex");
}
