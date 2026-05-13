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
