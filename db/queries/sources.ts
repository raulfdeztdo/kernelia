import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sources, type Source } from "@/db/schema";

export async function listActiveSources(): Promise<Source[]> {
  return db.select().from(sources).where(eq(sources.active, true));
}

export interface PublicSource {
  name: string;
  url: string;
}

export interface AdminSource {
  id: string;
  name: string;
  active: boolean;
}

/**
 * All sources (active + inactive) for the admin filter dropdown. Public
 * surfaces should keep using `listSourcesPublic`; this is admin-only.
 */
export async function listSourcesForAdmin(): Promise<AdminSource[]> {
  return db
    .select({ id: sources.id, name: sources.name, active: sources.active })
    .from(sources)
    .orderBy(asc(sources.name));
}

/**
 * Public, read-only list of source name + homepage URL for the /about page.
 * Excludes inactive sources and the rss_url details.
 */
export async function listSourcesPublic(): Promise<PublicSource[]> {
  return db
    .select({ name: sources.name, url: sources.url })
    .from(sources)
    .where(eq(sources.active, true))
    .orderBy(asc(sources.name));
}
