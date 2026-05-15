import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories, type Category } from "@/db/schema";

let cache: Map<string, string> | null = null;

export async function getCategoryMap(): Promise<Map<string, string>> {
  if (cache) return cache;
  const rows: Pick<Category, "id" | "slug">[] = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  cache = new Map(rows.map((row) => [row.slug, row.id]));
  return cache;
}

export function resetCategoryCache(): void {
  cache = null;
}

export interface CategoryListItem {
  id: string;
  slug: string;
  nameEs: string;
  nameEn: string;
}

/**
 * Full category catalog with display names. Used by admin UIs that need to
 * render a dropdown of the 10 slugs with their human-readable labels.
 */
export async function listCategories(): Promise<CategoryListItem[]> {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      nameEs: categories.nameEs,
      nameEn: categories.nameEn,
    })
    .from(categories)
    .orderBy(asc(categories.slug));
}
