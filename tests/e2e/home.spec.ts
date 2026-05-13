import { expect, test } from "@playwright/test";

test("loads Spanish home (default locale, no prefix)", async ({ page }) => {
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
