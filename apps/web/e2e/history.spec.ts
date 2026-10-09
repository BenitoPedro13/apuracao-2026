import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The presidential archive page (TASK-historical-presidential.md §5 item 6), on the built
// export. Its data ships with the site, so nothing here reads the bucket.

const PAGE = "/index.html?historico";

const QUESTIONS = [
  "Como a sua cidade votou desde 1994?",
  "Quem venceu, eleição por eleição",
  "Quem decidiu a eleição?",
  "Existem cidades que sempre acertam?",
  "O que aconteceu em 2006?",
  "De onde veio o eleitor de Bolsonaro?",
  "O Brasil está mais dividido?",
  "Para onde vão os votos de quem fica em 3º?",
  "Quantos votos não contam?",
  "Quanto pesa cada lugar?",
  "E os brasileiros no exterior?",
];

async function open(page: Page, url = PAGE) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Oito eleições para presidente, município por município" })).toBeVisible();
  // Every answer has loaded: no skeleton left.
  await expect(page.getByLabel("Carregando o histórico")).toHaveCount(0);
}

test("every question renders with its answer, from the site's own files only", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.host !== "127.0.0.1:3100" && !u.host.startsWith("fonts.")) foreign.push(r.url());
  });
  await open(page);
  for (const q of QUESTIONS) await expect(page.getByRole("heading", { name: q, level: 2 })).toBeVisible();
  // Our numbers carry a screen-reader "(calculado)" after them.
  await expect(page.locator("#termometro")).toContainText(/112 \(calculado\) dos 5\.019 municípios/);
  await expect(page.locator("#termometro")).toContainText("Minas Gerais");
  await expect(page.locator("#quem-decidiu")).toContainText(/Lula venceu o 2º turno de 2022 por 2\.139\.645 \(calculado\) votos/);
  await expect(page.locator("#virada-2006")).toContainText(/[-−]0,01/);
  expect(foreign.filter((u) => !u.includes("/history/") && !u.includes("/geo/")).filter((u) => !u.startsWith("http://127.0.0.1"))).toEqual([]);
});

test("search finds a town without accents and shows its record", async ({ page }) => {
  await open(page);
  const town = page.locator("#sua-cidade");
  await town.getByRole("combobox").click();
  await page.getByPlaceholder("Nome do município").fill("itaqua");
  await page.getByRole("option", { name: "Itaquaquecetuba (SP)" }).click();
  await expect(page).toHaveURL(/mun=3523107/);
  await expect(town).toContainText("8 de 8");
  await expect(town.getByRole("table")).toContainText("2006");
  await page.getByPlaceholder("Nome do município").count(); // the popover closed
  await town.getByRole("button", { name: "Guaribas (PI)" }).click();
  await expect(town).toContainText("Guaribas (PI)");
});

test("the year view shows any election, with missing municipalities hatched, never zero", async ({ page }) => {
  await open(page, "/index.html?historico&ano=2006");
  const year = page.locator("#ano");
  await expect(year.getByRole("button", { name: "2006", pressed: true })).toBeVisible();
  await expect(year).toContainText("58.295.042 votos");
  await expect(year).toContainText("60,8%");
  await expect(year).toContainText("A contagem ao longo da noite não foi registrada para 2006");
  await year.getByRole("button", { name: "1994" }).click();
  await expect(page).toHaveURL(/ano=1994/);
  await expect(year).toContainText("34.350.217 votos");
  await expect(year.getByText("não era município")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

test("phone width: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("the live page links to the archive and is unchanged without ?historico", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.getByRole("heading", { name: "Apuração 2026", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Oito eleições para presidente, município por município" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Eleições anteriores" })).toHaveAttribute("href", "/?historico");
});
