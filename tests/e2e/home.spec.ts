import { expect, test } from "@playwright/test";

test("loads Spanish home at /", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Últimas noticias");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});

test("loads English home at /en", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Latest news");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("switches locale from header", async ({ page }) => {
  await page.goto("/");
  // Scope to the locale switcher group so we don't collide with category
  // chips whose Spanish names contain the substring "en"
  // (e.g. "Modelos de lenguaje", "Agentes").
  const localeGroup = page.getByRole("group", { name: "Idioma" });
  await localeGroup.getByRole("button", { name: "en", exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("category filter updates URL", async ({ page }) => {
  await page.goto("/");
  // The "Agents" chip should be visible in the filter bar.
  const chip = page.getByRole("button", { name: /Agentes/i });
  await chip.click();
  await expect(page).toHaveURL(/category=agents/);
});

test("search input writes ?q= to URL", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("searchbox");
  // Make sure React has hydrated and the input is interactive before typing.
  // Otherwise on a slow runner the keystrokes can land before the onChange
  // listener is attached and the URL never updates.
  await expect(input).toBeVisible();
  await input.fill("openai");
  // The SearchBox debounces 350ms + startTransition + router.replace, so on a
  // cold CI runner the full pipeline can comfortably take 1.5-2s. Give it
  // 5s of headroom instead of the previous 2s ceiling.
  await expect(page).toHaveURL(/q=openai/, { timeout: 5000 });
});
