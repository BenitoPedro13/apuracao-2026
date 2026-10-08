import { Suspense } from "react";
import { ExteriorToggle } from "@/components/exterior-toggle";
import { Headline } from "@/components/headline";
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
// (?turno, ?uf, ?exterior), so each sits under a Suspense boundary.

const Loading = ({ h = "h-40" }: { h?: string }) => <Skeleton className={h} />;

export default function Home() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">Apuração 2026</h1>
            <span className="text-sm text-muted-foreground">Presidente</span>
            <Suspense>
              <RoundSelector />
            </Suspense>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
              <StatusLine />
              <ExteriorToggle />
            </Suspense>
            <PageActions />
          </div>
        </div>
      </header>

      <main id="conteudo" className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_minmax(0,20rem)]">
        <section aria-label="Resultado nacional" className="rounded-xl border bg-card p-4 sm:p-5 lg:row-span-2">
          <Suspense fallback={<Loading h="h-96" />}>
            <Headline />
          </Suspense>
        </section>

        <Panel id="mapa" title="Mapa por município">
          <p className="text-sm text-muted-foreground">
            O mapa ainda não está disponível. Os mesmos resultados estão nas tabelas{" "}
            <a href="#estados" className="underline underline-offset-4">
              por estado
            </a>{" "}
            e{" "}
            <a href="#municipios" className="underline underline-offset-4">
              por município
            </a>
            .
          </p>
        </Panel>

        <Panel id="regioes" title="Por região">
          <Suspense fallback={<Loading h="h-64" />}>
            <RegionsPanel />
          </Suspense>
        </Panel>

        <Panel id="estados" title="Por estado" className="lg:col-span-2">
          <Suspense fallback={<Loading h="h-96" />}>
            <UfTable />
          </Suspense>
        </Panel>

        <Panel id="municipios" title="Por município" className="lg:col-span-3">
          <Suspense fallback={<Loading h="h-96" />}>
            <MunicipalityTable />
          </Suspense>
        </Panel>
      </main>

      <footer className="border-t">
        <p className="mx-auto w-full max-w-7xl px-4 py-4 text-xs text-muted-foreground">
          Todos os números vêm dos arquivos publicados pelo TSE; os percentuais são os do próprio TSE. Valores marcados
          como calculados (diferença, regiões) são somas e contas nossas sobre esses arquivos.
        </p>
      </footer>
    </>
  );
}
