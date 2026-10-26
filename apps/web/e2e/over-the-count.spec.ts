import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { CountTimeline } from "@apuracao/contracts";
import { COUNT_TIMELINE_FILES } from "../src/timeline/timeline-files";

// "Ao longo da apuração" (TASK-over-the-count.md §5 item 4), on the live bucket's 2nd round.

const file = (id: keyof typeof COUNT_TIMELINE_FILES) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../public", COUNT_TIMELINE_FILES[id].path), "utf8")) as CountTimeline;
const pct = (x: number) => `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

test("the panel shows both years, ends on the shipped file's last point, and has a table", async ({ page }) => {
  test.skip(!("2026-2t" in COUNT_TIMELINE_FILES), "no 2026 2nd-round series built");
  const t = file("2026-2t" as keyof typeof COUNT_TIMELINE_FILES);
  await page.goto("/index.html");
  const panel = page.locator("#ao-longo");
  await expect(panel.getByRole("heading", { name: "Ao longo da apuração" })).toBeVisible();
  await expect(panel).toContainText("2022: Lula × Jair Bolsonaro");
  const last = t.at.length - 1;
  for (const i of t.candidates.keys()) await expect(panel.locator("svg")).toContainText(pct(t.votes[i]![last]! / t.valid[last]!));

  // The table: one row per 10% of sections, 2022 ending on its final result.
  await panel.getByText("Ver em tabela").click();
  const rows = panel.locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(rows.last()).toContainText("50,9%");
  await expect(rows.last()).toContainText("49,1%");

  // Keyboard: the crosshair is a slider; Home then 5 × Shift+→ reads every series at 50%.
  const slider = panel.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  await expect(slider).toHaveAttribute("aria-valuetext", /^50,0% das seções: Lula \(2026\) \d+,\d%, .* \(2022\) \d+,\d%$/);

  const results = await new AxeBuilder({ page }).include("#ao-longo").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("absent for other offices", async ({ page }) => {
  await page.goto("/index.html?cargo=governador");
  await expect(page.getByRole("heading", { name: /Governador/ }).first()).toBeVisible();
  await expect(page.locator("#ao-longo")).toHaveCount(0);
});
