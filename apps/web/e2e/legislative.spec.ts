import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { LatestPointer, LegislativeBrView, LegislativeUfView, Manifest, manifestKey, POINTER_KEY, viewKey } from "@apuracao/contracts";
import { liveJson, liveManifest, REPO, routeDataFrom } from "./data";

// Senate and deputies (TASK-legislative-archive.md §5 item 4). Reads the live bucket once
// it carries the legislative views; before the seed, the local real rebuild in
// .replay/real-legislative/pub (gitignored).

const LOCAL = join(REPO, ".replay/real-legislative/pub");
let PUB: string | undefined;
test.beforeAll(async () => {
  const { manifest } = await liveManifest();
  if (manifest.views["legislative/federal-deputy/br"]) return;
  if (!existsSync(LOCAL)) throw new Error(`the live bucket has no legislative views yet and ${LOCAL} is missing`);
  PUB = LOCAL;
});

async function open(page: Page, query: string) {
  if (PUB) await routeDataFrom(page, PUB, (p) => p);
  await page.goto(`/index.html?${query}`);
}

async function view<T>(name: string, schema: { parse: (x: unknown) => T }): Promise<T> {
  const get = async (key: string): Promise<unknown> =>
    PUB ? JSON.parse(readFileSync(join(PUB, key), "utf8")) : liveJson(key);
  const pointer = LatestPointer.parse(await get(POINTER_KEY));
  const manifest = Manifest.parse(await get(manifestKey(pointer.epoch, pointer.seq)));
  return schema.parse(await get(viewKey(manifest.views[name]!)));
}

test("Câmara: 513 elected, PL first, every party equals the summed view", async ({ page }) => {
  const br = await view("legislative/federal-deputy/br", LegislativeBrView);
  expect([br.complete, br.seatsCalc]).toEqual([true, 513]);
  await open(page, "cargo=camara");
  const composition = page.locator("#composicao");
  await expect(composition).toContainText("513 (calculado) deputados federais eleitos nas 27 UFs");
  const rows = await composition.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Array.from(tr.children, (c) => (c.textContent ?? "").trim()).join(" ")));
  expect(rows).toEqual(br.parties.map((p) => `${p.party} ${p.seatsCalc} (calculado)`));
  expect(rows[0]).toBe("PL 121 (calculado)");
  await expect(page.locator("#estados tbody tr")).toHaveCount(27);
});

test("Senado, SP: every candidate, the two elected marked in text, with alternates", async ({ page }) => {
  const sp = await view("legislative/senate/sp", LegislativeUfView);
  await open(page, "cargo=senado&uf=sp");
  const race = page.locator("#disputa");
  await expect(race.locator("tbody").first().locator("tr")).toHaveCount(sp.candidates.length);
  await expect(race.getByRole("cell", { name: "Eleito", exact: true })).toHaveCount(2);
  await expect(race).toContainText("1º suplente");
  await expect(page.getByRole("link", { name: "Senado" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("1º turno · resultado final")).toBeVisible();
});

test("the cargo links are reachable by keyboard and switch the page", async ({ page }) => {
  await open(page, "");
  await expect(page.getByRole("link", { name: "Presidente" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Assembleias" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/cargo=assembleias/);
  await expect(page.locator("#composicao")).toContainText("deputados estaduais e distritais eleitos");
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [375, 1440]) {
    test(`axe and no page scroll: Câmara + SP, ${colorScheme}, ${width} px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "cargo=camara&uf=sp");
      await expect(page.locator("#disputa tbody tr").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
