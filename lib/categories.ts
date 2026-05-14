import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/ai/schemas";

export { CATEGORY_SLUGS, type CategorySlug };

export function isCategorySlug(value: string): value is CategorySlug {
  return (CATEGORY_SLUGS as readonly string[]).includes(value);
}

export function parseCategoryParam(raw: string | string[] | undefined): CategorySlug[] {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : raw.split(",");
  const cleaned = new Set<CategorySlug>();
  for (const v of values) {
    const trimmed = v.trim().toLowerCase();
    if (isCategorySlug(trimmed)) cleaned.add(trimmed);
  }
  return [...cleaned];
}

/** Token used in <style> / CSS for the per-category accent color. */
export function categoryColorVar(slug: CategorySlug): string {
  return `var(--color-cat-${slug})`;
}
