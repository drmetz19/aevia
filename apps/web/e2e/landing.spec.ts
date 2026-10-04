import { expect, test } from "@playwright/test";

test("/c/drmetz: nama DrMetz + powered by AEVIA + CTA", async ({ page }) => {
  await page.goto("/c/drmetz");
  await expect(page.getByRole("banner").getByText("DrMetz")).toBeVisible();
  await expect(page.getByText("powered by AEVIA")).toBeVisible();
  await expect(page.getByText("Sovia adalah AI")).toBeVisible();
  await expect(page.getByRole("list").getByRole("heading", { name: "Follow-up & progres" })).toBeVisible();
  await page.getByRole("link", { name: /Mulai assessment/ }).click();
  await expect(page).toHaveURL(/\/c\/drmetz\/assessment$/);
});

test("/c/demo-partner: tidak ada kata AEVIA di mana pun", async ({ page }) => {
  await page.goto("/c/demo-partner");
  await expect(page.getByRole("banner").getByText("Lumina Skin Studio")).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/aevia/i);
  expect(await page.title()).not.toMatch(/aevia/i);
  const alts = await page.locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("alt") ?? ""));
  expect(alts.join(" ")).not.toMatch(/aevia/i);
});

test("slug tak dikenal → halaman 404 ramah", async ({ page }) => {
  const res = await page.goto("/c/tidak-ada");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Klinik belum ditemukan")).toBeVisible();
});

test("mobile 390: tanpa scroll horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/c/drmetz");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
