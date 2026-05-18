import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEMS, isNavItemActive } from "@/components/admin/sidebar";

/**
 * The active-link decision is the only logic in the sidebar; everything
 * else is JSX. We hand-test the two interesting corners:
 *
 * 1. `/admin` is `exact: true` so it should NOT light up for `/admin/users`
 *    (otherwise both entries would look active at the same time).
 * 2. Prefix entries must light up under their own sub-paths, including
 *    the trailing-slash boundary so `/admin/article` (a hypothetical typo
 *    route) does NOT match `/admin/articles`.
 */

const panel = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin");
const articles = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/articles");
const broadcasts = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/broadcasts");
const users = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/users");
const cron = ADMIN_NAV_ITEMS.find((i) => i.href === "/admin/cron");

if (!panel || !articles || !broadcasts || !users || !cron) {
  throw new Error("ADMIN_NAV_ITEMS shape changed; update this test");
}

describe("isNavItemActive", () => {
  it("Panel is active only on the exact /admin path", () => {
    expect(isNavItemActive(panel, "/admin")).toBe(true);
    expect(isNavItemActive(panel, "/admin/users")).toBe(false);
    expect(isNavItemActive(panel, "/admin/articles")).toBe(false);
    expect(isNavItemActive(panel, "/admin/broadcasts")).toBe(false);
    expect(isNavItemActive(panel, "/admin/cron")).toBe(false);
  });

  it("Articles is active on its own path and under it", () => {
    expect(isNavItemActive(articles, "/admin/articles")).toBe(true);
    // `usePathname` strips the query string, so we never see `?status=…`
    // in the input. The hypothetical detail route under /admin/articles
    // would still match thanks to the prefix rule.
    expect(isNavItemActive(articles, "/admin/articles/abc-123")).toBe(true);
  });

  it("does NOT match a path that merely shares the prefix as a substring", () => {
    // `/admin/article` vs `/admin/articles` — both start with `/admin/article`
    // when you naively use `startsWith(item.href)`. The trailing-slash check
    // prevents the false positive.
    expect(isNavItemActive(articles, "/admin/article")).toBe(false);
  });

  it("only one entry is active for any given path", () => {
    for (const path of [
      "/admin",
      "/admin/articles",
      "/admin/broadcasts",
      "/admin/users",
      "/admin/cron",
    ]) {
      const matches = ADMIN_NAV_ITEMS.filter((item) => isNavItemActive(item, path));
      expect(matches).toHaveLength(1);
    }
  });
});
