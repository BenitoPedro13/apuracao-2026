import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { MunicipalityView, viewKey } from "@apuracao/contracts";
import { liveJson, liveManifest } from "./data";

// Governadores (TASK-visual-pass-2.md §5 item 2), against the live bucket's 1st round.

test("27 tiles and the TSE's outcomes counted: 20 elected, 7 runoffs", async ({ page }) => {
  await page.goto("/index.html?cargo=governador");
  const summary = page.locator("#governadores");
  await expect(summary.getByRole("list", { name: "Estados" }).getByRole("button")).toHaveCount(27);
  await expect(summary).toContainText("27 (calculado) disputas · 20 (calculado) eleitos no 1º turno · 7 (calculado) no 2º turno");
  await expect(page.getByRole("link", { name: "Governadores" })).toHaveAttribute("aria-current", "page");
  // With no state picked, the closest race is shown and says so.
  await expect(page.locator("#governador-uf")).toContainText("A disputa mais apertada");
});

test("RJ: the runoff as the TSE has it, and its 92 municipalities", async ({ page }) => {
  const { manifest } = await liveManifest();
  const rj = MunicipalityView.parse(await liveJson(viewKey(manifest.views["municipalities/governor/rj"]!)));
  await page.goto("/index.html?cargo=governador&uf=rj");
  const race = page.locator("#governador-uf");
  await expect(race).toContainText("Governador · Rio de Janeiro");
  await expect(race).toContainText("Douglas Ruas");
  await expect(race).toContainText("49,27");
  await expect(race).toContainText("Eduardo Paes");
  await expect(race).toContainText("42,76");
  await expect(race.getByText("Situação no TSE: 2º turno")).toHaveCount(2);
  await expect(page.locator("#municipios tbody tr")).toHaveCount(rj.rows.length);
  expect(rj.rows.length).toBe(92);
});

test("a tile and a table row pick the state", async ({ page }) => {
  await page.goto("/index.html?cargo=governador");
  await page.getByRole("list", { name: "Estados" }).getByRole("button", { name: /^Bahia:/ }).click();
  await expect(page).toHaveURL(/uf=ba/);
  await expect(page.locator("#governador-uf")).toContainText("Governador · Bahia");
  await page.locator("#estados").getByRole("button", { name: "Pará: ver a disputa" }).click();
  await expect(page.locator("#governador-uf")).toContainText("Governador · Pará");
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [375, 1440]) {
    test(`axe and no page scroll: Governadores + RJ, ${colorScheme}, ${width} px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/index.html?cargo=governador&uf=rj");
      await expect(page.locator("#municipios tbody tr").first()).toBeVisible();
      await expect(page.locator("#mapa canvas").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
