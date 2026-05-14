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
  // Wait for the document and bundle to fully load so React has a chance
  // to attach its onChange handler to the input.
  await page.waitForLoadState("load");

  const input = page.getByRole("searchbox");
  await expect(input).toBeVisible();
  await input.focus();

  // `fill()` is one-shot: if React hasn't hydrated yet, the single onChange
  // is lost and the URL never updates (we observed "9× polled, never moved"
  // on slow runners). `pressSequentially` emits a keypress per char, so even
  // if the first one or two are dropped pre-hydration, the later ones will
  // fire onChange and the debounced commit() runs.
  await input.pressSequentially("openai", { delay: 80 });

  await expect(page).toHaveURL(/q=openai/, { timeout: 10000 });
});
