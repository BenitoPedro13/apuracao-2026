import { Suspense } from "react";
import { CargoNav } from "@/components/cargo-nav";
import { CargoSwitch, LegislativeOnlyNote, PresidentOnly } from "@/components/cargo-switch";
import { ExteriorToggle } from "@/components/exterior-toggle";
import { Headline } from "@/components/headline";
import { LegislativeSection } from "@/components/legislative-section";
import { MapSection } from "@/components/map/map-section";
import { MunicipalityTable } from "@/components/municipality-table";
import { PageActions } from "@/components/page-actions";
import { Panel } from "@/components/panel";
import { RegionsPanel } from "@/components/regions-panel";
import { RoundSelector } from "@/components/round-selector";
import { StatusLine } from "@/components/status-line";
import { UfTable } from "@/components/uf-table";
import { Skeleton } from "@/components/ui/skeleton";

// The static frame is rendered at build time; every live part is a client leaf reading the
// published views (TASK-web-shell-and-data-hooks.md §2.4). The leaves read the query string
// (?turno, ?uf, ?mapa, ?exterior), so each sits under a Suspense boundary.
// Layout: TASK-visual-identity.md §2.3. Every track is minmax(0, …) and every cell
// min-w-0, so wide content scrolls inside its panel, never the page.

const Loading = ({ h = "h-40" }: { h?: string }) => <Skeleton className={h} />;

export default function Home() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-panel px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-lg font-bold tracking-tight">Apuração 2026</h1>
            <span aria-hidden className="h-5 w-px bg-line" />
            <Suspense>
              <CargoNav />
              <PresidentOnly>
                <RoundSelector />
              </PresidentOnly>
              <LegislativeOnlyNote />
            </Suspense>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Suspense fallback={<p className="text-sm text-ink-2">Carregando…</p>}>
              <StatusLine />
              <PresidentOnly>
                <ExteriorToggle />
              </PresidentOnly>
            </Suspense>
            <PageActions />
          </div>
        </div>
      </header>

      <Suspense>
        <CargoSwitch
          president={
          <main
            id="conteudo"
            className="mx-auto grid w-full max-w-[96rem] flex-1 grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,18rem)]"
          >
            <section
              aria-label="Resultado nacional"
              className="min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5 lg:row-span-2 xl:row-span-1"
            >
              <Suspense fallback={<Loading h="h-96" />}>
                <Headline />
              </Suspense>
            </section>

            <Panel id="mapa" title="Mapa por município" className="min-w-0 lg:row-span-2 xl:row-span-1">
              <Suspense fallback={<Loading h="h-96" />}>
                <MapSection />
              </Suspense>
            </Panel>

            <Panel id="regioes" title="Por região" className="min-w-0">
              <Suspense fallback={<Loading h="h-64" />}>
                <RegionsPanel />
              </Suspense>
            </Panel>

            <div className="grid min-w-0 grid-cols-1 gap-3 lg:col-span-2 xl:col-span-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <Panel id="estados" title="Por estado" className="min-w-0">
                <Suspense fallback={<Loading h="h-96" />}>
                  <UfTable />
                </Suspense>
              </Panel>

              <Panel id="municipios" title="Por município" className="min-w-0">
                <Suspense fallback={<Loading h="h-96" />}>
                  <MunicipalityTable />
                </Suspense>
              </Panel>
            </div>
          </main>
          }
          legislative={<LegislativeSection />}
        />
      </Suspense>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-1 px-4 py-4 text-xs text-ink-2">
          <p>
            Todos os números vêm dos arquivos publicados pelo TSE; os percentuais são os do próprio TSE. Números{" "}
            <span className="calc">sublinhados assim</span> são calculados por nós sobre esses arquivos (diferenças,
            regiões, vantagens e contagens de municípios); passe o mouse sobre um deles para ver como.
          </p>
          <p>Mapa: IBGE, Malha Municipal 2025, simplificada.</p>
        </div>
      </footer>
    </>
  );
}
