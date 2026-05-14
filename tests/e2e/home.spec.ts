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
  await page.getByRole("button", { name: "en", exact: false }).click();
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
  await input.fill("openai");
  await expect(page).toHaveURL(/q=openai/, { timeout: 2000 });
});
