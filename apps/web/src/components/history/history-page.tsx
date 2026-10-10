import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Question } from "./question";
import { Abroad, Bellwethers, Divided, InvalidVotes, Realignment, RivalMap, Transfers, WhoDecided, Weight } from "./questions";
import { YearView } from "./year-view";
import { YourTown } from "./your-town";
import { StudioCredit } from "@/components/studio-credit";

// The presidential archive, 1994–2022 (TASK-historical-presidential.md): questions first,
// each with its answer, chart, method and table. Server component: the frame and the
// questions are static HTML; every answer is a client leaf reading the archive file.

const QUESTIONS: {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
}[] = [
  {
    id: "sua-cidade",
    eyebrow: "Sua cidade",
    title: "Como a sua cidade votou desde 1994?",
    body: <YourTown />,
  },
  {
    id: "ano",
    eyebrow: "Cada eleição",
    title: "Quem venceu, eleição por eleição",
    body: <YearView />,
  },
  {
    id: "quem-decidiu",
    eyebrow: "A diferença",
    title: "Quem decidiu a eleição?",
    body: <WhoDecided />,
  },
  {
    id: "termometro",
    eyebrow: "Termômetros",
    title: "Existem cidades que sempre acertam?",
    body: <Bellwethers />,
  },
  {
    id: "virada-2006",
    eyebrow: "A virada",
    title: "O que aconteceu em 2006?",
    body: <Realignment />,
  },
  {
    id: "antipetismo",
    eyebrow: "O outro lado",
    title: "De onde veio o eleitor de Bolsonaro?",
    body: <RivalMap />,
  },
  {
    id: "dividido",
    eyebrow: "Polarização",
    title: "O Brasil está mais dividido?",
    body: <Divided />,
  },
  {
    id: "segundo-turno",
    eyebrow: "Entre os turnos",
    title: "Para onde vão os votos de quem fica em 3º?",
    body: <Transfers />,
  },
  {
    id: "votos-que-nao-contam",
    eyebrow: "Abstenção, brancos e nulos",
    title: "Quantos votos não contam?",
    body: <InvalidVotes />,
  },
  {
    id: "peso",
    eyebrow: "Tamanho",
    title: "Quanto pesa cada lugar?",
    body: <Weight />,
  },
  {
    id: "exterior",
    eyebrow: "Exterior",
    title: "E os brasileiros no exterior?",
    body: <Abroad />,
  },
];

export function HistoryPage() {
  return (
    <>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href="/" className="text-lg font-bold tracking-tight underline-offset-4 hover:underline">
              Apuração 2026
            </Link>
            <span aria-hidden className="h-5 w-px self-center bg-line" />
            <span className="text-sm font-medium">Eleições presidenciais, 1994–2022</span>
          </div>
          <Link href="/" className="text-sm font-medium underline underline-offset-4">
            Voltar à apuração de 2026
          </Link>
        </div>
      </header>

      <main id="conteudo" className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col gap-6 px-3 py-6 sm:px-4">
        <div className="flex max-w-[62ch] flex-col gap-3 px-1">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">Oito eleições para presidente, município por município</h1>
          <p className="text-lg text-pretty text-ink-2">
            Os resultados finais de 1994 a 2022, dos arquivos do próprio TSE, e as perguntas que eles respondem: como a sua cidade vota, quem decide,
            o que mudou e o que se repete.
          </p>
          <nav aria-label="Perguntas">
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {QUESTIONS.map((q) => (
                <li key={q.id}>
                  <a href={`#${q.id}`} className="underline underline-offset-4">
                    {q.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {QUESTIONS.map((q) => (
          <Question key={q.id} id={q.id} eyebrow={q.eyebrow} title={q.title}>
            <Suspense fallback={<Skeleton className="h-72" />}>{q.body}</Suspense>
          </Question>
        ))}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-1 px-4 py-4 text-xs text-ink-2">
          <p>
            Fonte: TSE, Portal de Dados Abertos, arquivos <span className="font-mono">votacao_candidato_munzona</span> e{" "}
            <span className="font-mono">detalhe_votacao_munzona</span> de cada ano. Os arquivos trazem contagens, não percentuais: todos os
            percentuais, diferenças e correlações desta página são <span className="calc">calculados por nós</span>; passe o mouse sobre um deles para
            ver como.
          </p>
          <p>Mapa: IBGE, Malha Municipal 2025. Municípios criados depois de uma eleição aparecem hachurados nela, nunca como zero.</p>
          <StudioCredit />
        </div>
      </footer>
    </>
  );
}
