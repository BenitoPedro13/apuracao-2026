"use client";

import { useState } from "react";
import { Calc, Num } from "@/components/num";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  candidateName,
  formatR,
  leaderShares,
  millions,
  NORDESTE,
  pairs,
  pct,
  pearson,
  perMille,
  POLE_COLOR,
  pp,
  ptLeader,
  searchKey,
  shareOf,
  type HistoryModel,
} from "@/hooks/use-history";
import { formatInt } from "@/lib/format";
import { UF_NAMES } from "@/lib/places";
import type { FillToken } from "@/map/style";
import { HistoryMap } from "./history-map";
import { LineChart } from "./line-chart";
import { Answer, Method, Segmented, TableDisclosure } from "./question";
import { Scatter } from "./scatter";
import { placeName, WithHistory } from "./with-history";

// The history page's questions P2–P10 (TASK-historical-presidential.md §2.1). Each opens with
// its answer, computed here from the archive, never typed in; every figure is ours (the TSE's
// archive has counts only) and says how it was computed.

const short = (y: number) => `'${String(y).slice(2)}`;
const pairLabel = (a: number, b: number) => `${short(a)}→${short(b)}`;
const ufName = (uf: string) => UF_NAMES[uf.toLowerCase()] ?? uf;

// --- P2 · Quem decidiu? ---------------------------------------------------------------------

export function WhoDecided() {
  return <WithHistory>{(m) => <WhoDecidedInner m={m} />}</WithHistory>;
}

function WhoDecidedInner({ m }: { m: HistoryModel }) {
  const [year, setYear] = useState(m.years.at(-1)!);
  const r = m.decisive(year);
  const [a, b] = [r.candidates[0]!, r.candidates[1]!];
  const margin = r.national.votes[0]! - r.national.votes[1]!;
  const net = Object.entries(r.byUf)
    .map(([uf, t]) => ({ uf, v: t.votes[0]! - t.votes[1]! }))
    .sort((x, y) => y.v - x.v);
  const extra = [
    ...(r.abroad ? [{ uf: "Exterior", v: r.abroad.votes[0]! - r.abroad.votes[1]! }] : []),
    ...(r.transit ? [{ uf: "Em trânsito", v: r.transit.votes[0]! - r.transit.votes[1]! }] : []),
  ];
  const max = Math.max(...net.map((x) => Math.abs(x.v)), ...extra.map((x) => Math.abs(x.v)));
  const ne = net.filter((x) => NORDESTE.has(x.uf)).reduce((s, x) => s + x.v, 0);
  const colorA = POLE_COLOR[m.pole(r, 0)],
    colorB = POLE_COLOR[m.pole(r, 1)];
  const blankNull = r.national.brancos + r.national.nulos;
  const times = r.national.abstencoes / margin;

  return (
    <div className="flex flex-col gap-4">
      <Segmented label="Eleição" options={m.years} value={year} onChange={setYear} />
      <Answer>
        {candidateName(a)} venceu {r.round === 2 ? "o 2º turno" : "no 1º turno"} de {year} por{" "}
        <Calc how="Votos do 1º menos os do 2º colocado, no país todo.">{formatInt(margin)}</Calc> votos
        {times >= 1.5 ? (
          <>
            , <Calc how="Abstenções do turno divididas pela diferença entre os dois primeiros.">{formatInt(Math.round(times))} vezes</Calc> menos do
            que os <Num>{millions(r.national.abstencoes)}</Num> que não foram votar
          </>
        ) : null}
        . O Nordeste deu {ne >= 0 ? `a ${candidateName(a)}` : `a ${candidateName(b)}`} um saldo de{" "}
        <Calc how="Soma, nos 9 estados do Nordeste, dos votos do 1º menos os do 2º colocado.">{millions(Math.abs(ne))}</Calc>; o resto do país e o
        exterior, um saldo de <Calc how="A diferença nacional menos o saldo do Nordeste.">{millions(Math.abs(margin - ne))}</Calc> para{" "}
        {margin - ne >= 0 ? candidateName(a) : candidateName(b)}.
      </Answer>

      <div
        className="flex flex-col gap-1"
        role="img"
        aria-label={`Saldo de votos por estado em ${year}: à direita, ${candidateName(a)}; à esquerda, ${candidateName(b)}. A tabela abaixo traz os números.`}
      >
        <div className="grid grid-cols-[3.5rem_1fr_1fr] gap-x-2 text-xs font-medium text-ink-2">
          <span />
          <span className="text-right">
            ← {candidateName(b)} ({b.party})
          </span>
          <span>
            {candidateName(a)} ({a.party}) →
          </span>
        </div>
        {[...net, ...extra].map((x) => (
          <div key={x.uf} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-x-2 text-xs">
            <span className="font-mono font-semibold" title={x.uf.length === 2 ? ufName(x.uf) : x.uf}>
              {x.uf.length === 2 ? x.uf : x.uf === "Exterior" ? "Ext." : "Trâns."}
            </span>
            {/* Each side's label sits at the end of its own bar. */}
            <div className="flex items-center justify-end gap-1.5">
              {x.v < 0 && (
                <>
                  <span className="calc font-mono whitespace-nowrap text-ink-2">{millions(-x.v)}</span>
                  <div className="h-3 rounded-l-sm" style={{ width: `${(-x.v / max) * 100}%`, background: colorB }} />
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {x.v >= 0 && (
                <>
                  <div className="h-3 rounded-r-sm" style={{ width: `${(x.v / max) * 100}%`, background: colorA }} />
                  <span className="calc font-mono whitespace-nowrap text-ink-2">{millions(x.v)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <Method>
        <p>
          Saldo de um estado: votos de {candidateName(a)} menos votos de {candidateName(b)} ali, somados nos arquivos por município e zona do TSE. A
          soma dos saldos de todos os estados, do exterior
          {r.transit ? " e do voto em trânsito" : ""} é a diferença nacional.
        </p>
        <p>
          Brancos e nulos nesse turno: <Num>{formatInt(blankNull)}</Num>. Abstenções: <Num>{formatInt(r.national.abstencoes)}</Num>.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">{candidateName(a)}</TableHead>
              <TableHead className="text-right">{candidateName(b)}</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ...Object.entries(r.byUf).map(([uf, t]) => [ufName(uf), t] as const),
              ...(r.abroad ? [["Exterior", r.abroad] as const] : []),
              ...(r.transit ? [["Em trânsito", r.transit] as const] : []),
            ].map(([name, t]) => (
              <TableRow key={name}>
                <TableCell>{name}</TableCell>
                <TableCell className="text-right">
                  <Num>{formatInt(t.votes[0]!)}</Num>
                </TableCell>
                <TableCell className="text-right">
                  <Num>{formatInt(t.votes[1]!)}</Num>
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Votos do 1º menos os do 2º.">{formatInt(t.votes[0]! - t.votes[1]!)}</Calc>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P3 · Cidades que sempre acertam --------------------------------------------------------

const hitToken = (h: number | null): FillToken | null =>
  h === null ? null : h <= 4 ? "counted-1" : h === 5 ? "counted-2" : h === 6 ? "counted-3" : h === 7 ? "counted-4" : "counted-5";

export function Bellwethers() {
  return <WithHistory>{(m) => <BellwethersInner m={m} />}</WithHistory>;
}

function BellwethersInner({ m }: { m: HistoryModel }) {
  const { bellwetherHits: hits, mirrorGap, universe } = m.file.insights;
  const all = hits.flatMap((h, i) => (h === 8 ? [i] : []));
  const byUf = new Map<string, number>();
  for (const i of all) byUf.set(m.file.uf[i]!, (byUf.get(m.file.uf[i]!) ?? 0) + 1);
  const [topUf, topN] = [...byUf].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const largest = [...all].sort((a, b) => (m.file.aptos[b] ?? 0) - (m.file.aptos[a] ?? 0));
  const dist = Array.from({ length: 9 }, (_, k) => hits.filter((h) => h === k).length);
  const mirrorOf = (minAptos: number) =>
    mirrorGap
      .flatMap((g, i) => (g !== null && (m.file.aptos[i] ?? 0) >= minAptos ? [{ i, g }] : []))
      .sort((a, b) => a.g - b.g)
      .slice(0, 5);
  const n = m.years.length;

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        <Calc how={`Municípios que votaram nas ${n} eleições e cujo mais votado no turno decisivo foi sempre o eleito.`}>
          {formatInt(all.length)}
        </Calc>{" "}
        dos <Num>{formatInt(universe)}</Num> municípios que votaram em todas as {n} eleições escolheram o presidente eleito todas as vezes, e{" "}
        <Calc how="Contagem por estado dos municípios acima.">{topN}</Calc> deles ficam em {ufName(topUf)}.
      </Answer>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <HistoryMap
          m={m}
          styleKey="hits"
          tokenOf={(i) => hitToken(hits[i] ?? null)}
          describe={(i) =>
            hits[i] === null ? `${placeName(m, i)}\nnão votou em todas as ${n} eleições` : `${placeName(m, i)}\nvotou no eleito em ${hits[i]} de ${n}`
          }
          summary={`Mapa: em quantas das ${n} eleições cada município votou em quem foi eleito; mais escuro, mais acertos. A lista ao lado e a tabela trazem os números.`}
          legend={[
            { token: "counted-1", label: "até 4" },
            { token: "counted-2", label: "5" },
            { token: "counted-3", label: "6" },
            { token: "counted-4", label: "7" },
            { token: "counted-5", label: `${n} de ${n}` },
            { token: "absent", label: "não votou em todas" },
          ]}
        />
        <div className="flex min-w-0 flex-col gap-4 text-sm">
          <div>
            <h3 className="mb-1 font-semibold">Os maiores que acertaram todas</h3>
            <ol className="flex flex-col divide-y">
              {largest.slice(0, 10).map((i) => (
                <li key={i} className="flex justify-between gap-2 py-1">
                  <span>{placeName(m, i)}</span>
                  <Num className="text-ink-2">{formatInt(m.file.aptos[i] ?? 0)}</Num>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-xs text-ink-2">Eleitores aptos em 2022.</p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">O espelho do Brasil</h3>
            <p className="mb-1 text-xs text-ink-2">Onde o eleito teve, em média, quase a mesma fatia dos votos que teve no país:</p>
            <ol className="flex flex-col divide-y">
              {mirrorOf(0).map(({ i, g }) => (
                <li key={i} className="flex justify-between gap-2 py-1">
                  <span>{placeName(m, i)}</span>
                  <Calc how="Média, nos turnos decisivos, da distância entre a fatia do eleito aqui e no Brasil." className="text-ink-2">
                    {pct(perMille(g)).replace("%", " p.p.")}
                  </Calc>
                </li>
              ))}
            </ol>
            <p className="mt-2 mb-1 text-xs text-ink-2">Entre as cidades com mais de 200 mil eleitores:</p>
            <ol className="flex flex-col divide-y">
              {mirrorOf(200_000).map(({ i, g }) => (
                <li key={i} className="flex justify-between gap-2 py-1">
                  <span>{placeName(m, i)}</span>
                  <Calc how="Média, nos turnos decisivos, da distância entre a fatia do eleito aqui e no Brasil." className="text-ink-2">
                    {pct(perMille(g)).replace("%", " p.p.")}
                  </Calc>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <Method>
        <p>
          Turno decisivo: o 2º turno, ou o 1º quando não houve 2º (1994, 1998). Um município acerta quando o mais votado ali é quem foi eleito; um
          empate exato não conta como acerto. Só entram os {formatInt(universe)} municípios que votaram nas {n} eleições: os criados depois de 1994
          ficam de fora.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Acertos</TableHead>
              <TableHead className="text-right">Municípios</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dist.map((c, k) => (
              <TableRow key={k}>
                <TableCell className="font-mono">
                  {k} de {n}
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Contagem de municípios.">{formatInt(c)}</Calc>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P4 · A virada de 2006 ------------------------------------------------------------------

export function Realignment() {
  return <WithHistory h="h-[32rem]">{(m) => <RealignmentInner m={m} />}</WithHistory>;
}

function RealignmentInner({ m }: { m: HistoryModel }) {
  const per = m.file.insights.ptPersistence;
  const brk = per.reduce((lo, p) => (p.r < lo.r ? p : lo), per[0]!);
  const others = per.filter((p) => p !== brk).map((p) => p.r);
  const xs = leaderShares(m, brk.from, ptLeader(m, brk.from));
  const ys = leaderShares(m, brk.to, ptLeader(m, brk.to));
  const pts = pairs(xs, ys);
  const ne = new Set(pts.filter((p) => NORDESTE.has(m.file.uf[p.i]!)).map((p) => p.i));
  const g = m.indexOf("2204550"); // Guaribas (PI), where Fome Zero began in 2003
  const { belowToAbove, aboveToBelow } = m.file.insights.flips;
  const last = m.years.at(-1)!;

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        O PT ganhou em {brk.from} e em {brk.to}, mas com eleitores de outros lugares: a correlação entre o voto no PT de cada município nas duas
        eleições é{" "}
        <Calc how="Correlação de Pearson, entre os municípios, da fatia do PT no 1º turno de uma eleição e na seguinte.">{formatR(brk.r)}</Calc>, ou
        seja, nenhuma. Entre quaisquer outras duas eleições seguidas ela fica entre{" "}
        <Calc how="A menor das outras correlações.">{formatR(Math.min(...others))}</Calc> e{" "}
        <Calc how="A maior das outras correlações.">{formatR(Math.max(...others))}</Calc>.
      </Answer>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-semibold">Quanto o mapa do PT se repete de uma eleição para a outra</h3>
          <LineChart
            label="Correlação do voto no PT por município entre eleições seguidas"
            x={per.map((p) => pairLabel(p.from, p.to))}
            series={[
              {
                name: "correlação",
                color: "var(--ink)",
                values: per.map((p) => p.r),
              },
            ]}
            yMin={-0.2}
            yMax={1}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            format={(v) => formatR(v)}
            tip={(v) => formatR(v)}
            marker={per.indexOf(brk)}
          />
          <p className="text-sm text-ink-2">Perto de 1: as mesmas cidades continuam fortes e fracas para o PT. Perto de 0: o mapa foi redesenhado.</p>
          {g >= 0 && xs[g] !== null && ys[g] !== null && (
            <p className="text-sm">
              <span className="font-semibold">Guaribas (PI)</span>, onde o Fome Zero começou em 2003: o PT foi de{" "}
              <Calc how="Fatia do PT nos válidos do 1º turno.">{pct(xs[g]!)}</Calc> em {brk.from} para{" "}
              <Calc how="Fatia do PT nos válidos do 1º turno.">{pct(ys[g]!)}</Calc> em {brk.to}.
            </p>
          )}
          <p className="text-sm">
            De 2002 para {last},{" "}
            <Calc how="Municípios mais de 5 pontos abaixo da fatia nacional do PT em 2002 e mais de 5 acima em 2022.">{formatInt(belowToAbove)}</Calc>{" "}
            municípios passaram de votar menos no PT do que o Brasil a votar mais;{" "}
            <Calc how="O inverso: mais de 5 pontos acima em 2002, mais de 5 abaixo em 2022.">{formatInt(aboveToBelow)}</Calc> fizeram o caminho
            contrário.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-semibold">
            Cada município: PT em {brk.from} × PT em {brk.to}
          </h3>
          <Scatter
            label={`Fatia do PT no 1º turno de ${brk.from} (horizontal) e de ${brk.to} (vertical), por município; o Nordeste em destaque.`}
            points={pts}
            xLabel={`PT em ${brk.from}`}
            yLabel={`PT em ${brk.to}`}
            highlight={ne}
            describe={(i) => `${placeName(m, i)}\nPT ${brk.from}: ${pct(xs[i]!)}\nPT ${brk.to}: ${pct(ys[i]!)}`}
          />
          <p className="text-xs text-ink-2">
            <span aria-hidden style={{ color: "var(--pt)" }}>
              ●
            </span>{" "}
            Nordeste. Acima da linha tracejada, o PT cresceu.
          </p>
        </div>
      </div>
      <Method>
        <p>
          Fatia do PT: votos do candidato do PT (Lula até 2006 e em 2022, Dilma em 2010 e 2014, Haddad em 2018) sobre os válidos do município no 1º
          turno. A correlação de Pearson compara essa fatia em duas eleições, entre todos os municípios que votaram nas duas. Ela mede se a ordem das
          cidades se mantém, não se o PT ganhou ou perdeu votos.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Eleições</TableHead>
              <TableHead className="text-right">Correlação</TableHead>
              <TableHead className="text-right">Municípios</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {per.map((p) => (
              <TableRow key={p.from}>
                <TableCell className="font-mono">
                  {p.from} → {p.to}
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Correlação de Pearson.">{formatR(p.r)}</Calc>
                </TableCell>
                <TableCell className="text-right">
                  <Num>{formatInt(p.n)}</Num>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P5 · De onde veio o eleitor de Bolsonaro? ----------------------------------------------

export function RivalMap() {
  return <WithHistory h="h-[32rem]">{(m) => <RivalMapInner m={m} />}</WithHistory>;
}

function RivalMapInner({ m }: { m: HistoryModel }) {
  const per = m.file.insights.rivalPersistence;
  // The year a new rival appeared: the newest pair whose names differ and whose party changed.
  const partyOf = (y: number, name: string) => m.first(y).candidates.find((c) => c.name === name)?.party;
  // A new candidate from a new party (Aécio, PSDB → Bolsonaro, PSL), not the same person changing party.
  const change = [...per]
    .reverse()
    .find(
      (p) =>
        searchKey(p.toName) !== searchKey(p.fromName) &&
        !p.toName.includes(p.fromName) &&
        !p.fromName.includes(p.toName) &&
        partyOf(p.to, p.toName) !== partyOf(p.from, p.fromName),
    )!;
  const r1 = m.first(change.from),
    r2 = m.first(change.to);
  const rivalIdx = (r: typeof r1, name: string) => r.candidates.slice(0, 3).findIndex((c) => c.name === name);
  const newRival = leaderShares(m, change.to, rivalIdx(r2, change.toName));
  const oldRival = leaderShares(m, change.from, rivalIdx(r1, change.fromName));
  // The other big non-PT candidate of the earlier year (Marina Silva in 2014), if in the top 3.
  const thirdIdx = r1.candidates.slice(0, 3).findIndex((c, k) => k !== rivalIdx(r1, change.fromName) && c.party !== "PT");
  const third = thirdIdx >= 0 ? leaderShares(m, change.from, thirdIdx) : null;
  const a = pairs(oldRival, newRival),
    b = third ? pairs(third, newRival) : [];
  const rb = b.length
    ? pearson(
        b.map((p) => p.x),
        b.map((p) => p.y),
      )
    : null;
  const nameOf = (r: typeof r1, name: string) => candidateName(r.candidates.find((c) => c.name === name)!);
  const newName = nameOf(r2, change.toName),
    oldName = nameOf(r1, change.fromName);
  const thirdName = thirdIdx >= 0 ? candidateName(r1.candidates[thirdIdx]!) : "";
  const steady = per.filter((p) => p.from >= 2006);

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        Do mapa de {oldName}: a correlação entre a votação de {oldName} em {change.from} e a de {newName} em {change.to}, município a município, é{" "}
        <Calc how="Correlação de Pearson das fatias no 1º turno.">{formatR(change.r)}</Calc>
        {rb !== null && (
          <>
            ; com a de {thirdName}, <Calc how="Correlação de Pearson das fatias no 1º turno.">{formatR(rb)}</Calc>
          </>
        )}
        . O mapa do principal adversário do PT mudou pouco desde 2006, qualquer que fosse o partido.
      </Answer>
      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-semibold">
            {oldName} {change.from} × {newName} {change.to}
          </h3>
          <Scatter
            label={`Fatia de ${oldName} em ${change.from} e de ${newName} em ${change.to}, por município`}
            points={a}
            xLabel={`${oldName} ${change.from}`}
            yLabel={`${newName} ${change.to}`}
            describe={(i) => `${placeName(m, i)}\n${oldName}: ${pct(oldRival[i]!)}\n${newName}: ${pct(newRival[i]!)}`}
          />
        </div>
        {third && (
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-semibold">
              {thirdName} {change.from} × {newName} {change.to}
            </h3>
            <Scatter
              label={`Fatia de ${thirdName} em ${change.from} e de ${newName} em ${change.to}, por município`}
              points={b}
              xLabel={`${thirdName} ${change.from}`}
              yLabel={`${newName} ${change.to}`}
              describe={(i) => `${placeName(m, i)}\n${thirdName}: ${pct(third[i]!)}\n${newName}: ${pct(newRival[i]!)}`}
            />
          </div>
        )}
      </div>
      <div className="flex max-w-2xl min-w-0 flex-col gap-2">
        <h3 className="font-semibold">Quanto o mapa do adversário do PT se repete</h3>
        <LineChart
          label="Correlação, por município, do voto no principal adversário do PT entre eleições seguidas"
          x={per.map((p) => pairLabel(p.from, p.to))}
          series={[
            {
              name: "correlação",
              color: "var(--pl)",
              values: per.map((p) => p.r),
            },
          ]}
          yMin={0}
          yMax={1}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          format={formatR}
          tip={(v, i) =>
            `${formatR(v)} (${candidateName(m.first(per[i]!.from).candidates.find((c) => c.name === per[i]!.fromName)!)} → ${candidateName(m.first(per[i]!.to).candidates.find((c) => c.name === per[i]!.toName)!)})`
          }
          marker={per.indexOf(change)}
        />
        {steady.length > 0 && (
          <p className="text-sm text-ink-2">
            Desde 2006: entre <Calc how="A menor correlação desde 2006.">{formatR(Math.min(...steady.map((p) => p.r)))}</Calc> e{" "}
            <Calc how="A maior correlação desde 2006.">{formatR(Math.max(...steady.map((p) => p.r)))}</Calc>.
          </p>
        )}
      </div>
      <Method>
        <p>
          O principal adversário do PT em cada eleição é o candidato não petista mais votado no 1º turno: Fernando Henrique (1994, 1998), Serra (2002,
          2010), Alckmin (2006), Aécio (2014), Bolsonaro (2018, 2022). A correlação compara as fatias dos válidos no 1º turno, município a município.
          Ela mostra que os mesmos lugares votaram contra o PT; não diz que foram as mesmas pessoas.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>De</TableHead>
              <TableHead>Para</TableHead>
              <TableHead className="text-right">Correlação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {per.map((p) => (
              <TableRow key={p.from}>
                <TableCell>
                  {nameOf(m.first(p.from), p.fromName)} {p.from}
                </TableCell>
                <TableCell>
                  {nameOf(m.first(p.to), p.toName)} {p.to}
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Correlação de Pearson.">{formatR(p.r)}</Calc>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P6 · O Brasil está mais dividido? ------------------------------------------------------

export function Divided() {
  return <WithHistory h="h-[32rem]">{(m) => <DividedInner m={m} />}</WithHistory>;
}

function DividedInner({ m }: { m: HistoryModel }) {
  const ls = m.file.insights.landslide;
  const share = ls.map((l) => l.voters / l.of);
  const k = share.length - 1;
  const min = share.indexOf(Math.min(...share)),
    max = share.indexOf(Math.max(...share));
  const [year, setYear] = useState(m.years.at(-1)!);
  const yi = m.years.indexOf(year);
  const dec = m.file.insights.decisive[yi]!;
  const r = m.decisive(year);
  const tokenOf = (i: number): FillToken | null => {
    const w = dec.winner[i],
      mg = dec.marginPm[i];
    if (w === null || w === undefined || mg === null || mg === undefined) return null;
    if (w === -1 || mg < 400) return "other-1";
    const pole = m.pole(r, w);
    return pole === "pt" ? "pt-4" : pole === "rival" ? "pl-4" : "other-3";
  };

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        Em {ls[k]!.year},{" "}
        <Calc how="Eleitores aptos de municípios onde o vencedor teve 40 pontos ou mais de vantagem no turno decisivo, sobre o total.">
          {pct(share[k]!)}
        </Calc>{" "}
        dos eleitores viviam numa cidade de vitória folgada (70 × 30 ou mais),{" "}
        {min === k ? "a menor fatia desde 1994" : `contra ${pct(share[min]!)} em ${ls[min]!.year}, a menor`}; em {ls[max]!.year} eram{" "}
        <Calc how="A mesma conta para aquele ano.">{pct(share[max]!)}</Calc>, a maior. O país pode estar dividido, mas não está cada vez mais separado
        em cidades de um lado só.
      </Answer>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-semibold">Eleitores em cidades de vitória folgada</h3>
          <LineChart
            label="Fatia dos eleitores em municípios com vitória por 40 pontos ou mais, por eleição"
            x={ls.map((l) => String(l.year))}
            series={[{ name: "vitória folgada", color: "var(--ink)", values: share }]}
            yMax={0.5}
            ticks={[0, 0.1, 0.2, 0.3, 0.4, 0.5]}
            format={(v) => `${Math.round(v * 100)}%`}
            tip={(v, i) => `${pct(v)} (${formatInt(ls[i]!.municipalities)} municípios)`}
          />
          <p className="text-xs text-ink-2">
            1994 e 1998 foram decididas no 1º turno, com mais candidatos: ali, 40 pontos de vantagem não é o mesmo que 70 × 30.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-semibold">Onde foi folgado</h3>
          <Segmented label="Eleição" options={m.years} value={year} onChange={setYear} />
          <HistoryMap
            m={m}
            styleKey={`landslide-${year}`}
            tokenOf={tokenOf}
            describe={(i) => {
              const w = dec.winner[i],
                mg = dec.marginPm[i];
              if (w === null || w === undefined || mg === null || mg === undefined) return `${placeName(m, i)}\nnão era município em ${year}`;
              if (w === -1) return `${placeName(m, i)}\nempate exato`;
              return `${placeName(m, i)}\n${candidateName(r.candidates[w]!)} por ${pct(perMille(mg)).replace("%", " pontos")}`;
            }}
            summary={`Mapa: municípios onde o vencedor de ${year} teve 40 pontos ou mais de vantagem, na cor do seu lado; os demais em cinza.`}
            legend={[
              {
                token: m.pole(r, 0) === "pt" ? "pt-4" : "pl-4",
                label: `${candidateName(r.candidates[0]!)}, folgado`,
              },
              {
                token: m.pole(r, 1) === "pt" ? "pt-4" : "pl-4",
                label: `${candidateName(r.candidates[1]!)}, folgado`,
              },
              { token: "other-1", label: "disputado (menos de 40 pontos)" },
              { token: "absent", label: "não era município" },
            ]}
          />
        </div>
      </div>
      <Method>
        <p>
          Para cada município, a vantagem do mais votado sobre o segundo no turno decisivo, sobre os válidos. Contamos os eleitores aptos dos
          municípios com 40 pontos ou mais de vantagem (70% × 30% numa disputa a dois) e dividimos pelo total de aptos dos municípios. O exterior fica
          de fora.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Eleição</TableHead>
              <TableHead className="text-right">Eleitores em vitória folgada</TableHead>
              <TableHead className="text-right">Fatia</TableHead>
              <TableHead className="text-right">Municípios</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ls.map((l) => (
              <TableRow key={l.year}>
                <TableCell className="font-mono">
                  {l.year} {l.round}ºT
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Soma dos aptos.">{formatInt(l.voters)}</Calc>
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Sobre o total de aptos dos municípios.">{pct(l.voters / l.of)}</Calc>
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="Contagem de municípios.">
                    {formatInt(l.municipalities)} de {formatInt(l.ofMunicipalities)}
                  </Calc>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P7 · Para onde vão os votos de quem fica em 3º? ----------------------------------------

export function Transfers() {
  return <WithHistory>{(m) => <TransfersInner m={m} />}</WithHistory>;
}

function TransfersInner({ m }: { m: HistoryModel }) {
  const t = m.file.insights.transfers;
  const last = t.at(-1)!;
  const r2 = m.decisive(last.year);
  const [a, b] = [r2.candidates[0]!, r2.candidates[1]!];
  const max = Math.max(...t.flatMap((x) => [x.others, ...x.gains.map(Math.abs)]));
  const bar = (v: number, color: string, label: string) => (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2 text-xs">
      <span className="truncate text-ink-2">{label}</span>
      <div className="flex items-center gap-1.5">
        <div
          className="h-3 rounded-r-sm"
          style={{
            width: `${(Math.max(0, v) / max) * 100}%`,
            background: color,
          }}
        />
        <span className="calc font-mono whitespace-nowrap">{v < 0 ? millions(v) : `+${millions(v)}`}</span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        Entre os turnos de {last.year}, {candidateName(b)} ganhou <Calc how="Votos no 2º turno menos votos no 1º.">{millions(last.gains[1])}</Calc> de
        votos e {candidateName(a)}, <Calc how="Votos no 2º turno menos votos no 1º.">{millions(last.gains[0])}</Calc>. Os outros candidatos tinham
        somado <Calc how="Votos no 1º turno de todos os candidatos que não foram ao 2º.">{millions(last.others)}</Calc> no 1º turno.
      </Answer>
      <ul className="flex flex-col gap-4">
        {t.map((x) => {
          const r = m.decisive(x.year);
          return (
            <li key={x.year} className="flex flex-col gap-1">
              <p className="font-mono text-sm font-semibold">{x.year}</p>
              {bar(x.others, "var(--party-other)", "outros, no 1º turno")}
              {bar(x.gains[0], POLE_COLOR[m.pole(r, 0)], `${candidateName(r.candidates[0]!)} ganhou`)}
              {bar(x.gains[1], POLE_COLOR[m.pole(r, 1)], `${candidateName(r.candidates[1]!)} ganhou`)}
            </li>
          );
        })}
      </ul>
      <Method>
        <p>
          O ganho de um finalista é a diferença entre os seus votos no 2º e no 1º turno, no país todo. Ele não vem só de quem votou nos outros
          candidatos: também de quem se absteve ou votou branco ou nulo no 1º turno e votou no 2º, e vice-versa.
        </p>
        <p>
          Entre os municípios, onde os outros candidatos foram mais fortes no 1º turno, os finalistas ganharam mais no 2º. Para cada ponto a mais dos
          outros candidatos num município, {candidateName(b)} ganhou em média{" "}
          <Calc how="Inclinação da reta de mínimos quadrados entre os municípios.">{last.slope[1].toFixed(2).replace(".", ",")}</Calc> ponto e{" "}
          {candidateName(a)},{" "}
          <Calc how="Inclinação da reta de mínimos quadrados entre os municípios.">{last.slope[0].toFixed(2).replace(".", ",")}</Calc>. É uma
          associação entre lugares, não a prova de para onde foi cada eleitor (a chamada falácia ecológica).
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Eleição</TableHead>
              <TableHead className="text-right">Outros no 1º turno</TableHead>
              <TableHead className="text-right">Ganho do 1º</TableHead>
              <TableHead className="text-right">Ganho do 2º</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.map((x) => (
              <TableRow key={x.year}>
                <TableCell className="font-mono">{x.year}</TableCell>
                <TableCell className="text-right">
                  <Calc how="Soma dos votos.">{formatInt(x.others)}</Calc>
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="2º turno menos 1º.">{formatInt(x.gains[0])}</Calc>
                </TableCell>
                <TableCell className="text-right">
                  <Calc how="2º turno menos 1º.">{formatInt(x.gains[1])}</Calc>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P8 · Quantos votos não contam? ---------------------------------------------------------

export function InvalidVotes() {
  return <WithHistory>{(m) => <InvalidVotesInner m={m} />}</WithHistory>;
}

function InvalidVotesInner({ m }: { m: HistoryModel }) {
  const firsts = m.years.map((y) => m.first(y).national);
  const abst = firsts.map((n) => n.abstencoes / n.aptos);
  const blank = firsts.map((n) => n.brancos / n.comparecimento);
  const nul = firsts.map((n) => n.nulos / n.comparecimento);
  const invalid = firsts.map((_, k) => blank[k]! + nul[k]!);
  const i02 = m.years.indexOf(2002),
    i06 = m.years.indexOf(2006);
  const up = m.years.filter((y) => {
    const rs = m.roundsOf(y);
    return rs.length === 2 && rs[1]!.national.comparecimento > rs[0]!.national.comparecimento;
  });

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        Brancos e nulos eram <Calc how="Brancos mais nulos sobre o comparecimento, 1º turno.">{pct(invalid[0]!)}</Calc> de quem votou em {m.years[0]}{" "}
        e <Calc how="Brancos mais nulos sobre o comparecimento, 1º turno.">{pct(invalid[i02]!)}</Calc> em 2002, a primeira eleição presidencial toda
        na urna eletrônica. Já a abstenção subiu de <Calc how="Abstenções sobre aptos, 1º turno.">{pct(abst[i06]!)}</Calc> em 2006 para{" "}
        <Calc how="Abstenções sobre aptos, 1º turno.">{pct(abst.at(-1)!)}</Calc> em {m.years.at(-1)}.
        {up.length > 0 && ` E ${up.join(", ")} foi o único 2º turno com mais eleitores do que o 1º.`}
      </Answer>
      <div className="max-w-2xl">
        <LineChart
          label="Abstenção, votos nulos e brancos no 1º turno, por eleição"
          x={m.years.map(String)}
          series={[
            { name: "Abstenção", color: "var(--pl)", values: abst },
            { name: "Nulos", color: "var(--party-other)", values: nul },
            {
              name: "Brancos",
              color: "var(--ink-2)",
              values: blank,
              dashed: true,
            },
          ]}
          yMax={0.25}
          ticks={[0, 0.05, 0.1, 0.15, 0.2, 0.25]}
          format={(v) => `${Math.round(v * 100)}%`}
          tip={(v) => pct(v)}
        />
      </div>
      <Method>
        <p>Abstenção: abstenções sobre eleitores aptos. Brancos e nulos: sobre quem compareceu. Todos do 1º turno, somados nos arquivos do TSE.</p>
        <p>
          As datas da urna eletrônica (parte dos eleitores em 1996 e 1998, todos a partir de 2000) são do próprio TSE; aqui só mostramos o que
          aconteceu com os brancos e nulos depois dela.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Eleição</TableHead>
              <TableHead className="text-right">Aptos</TableHead>
              <TableHead className="text-right">Abstenções</TableHead>
              <TableHead className="text-right">Brancos</TableHead>
              <TableHead className="text-right">Nulos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.years.flatMap((y) =>
              m.roundsOf(y).map((r) => (
                <TableRow key={`${y}-${r.round}`}>
                  <TableCell className="font-mono">
                    {y} {r.round}ºT
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{formatInt(r.national.aptos)}</Num>
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{formatInt(r.national.abstencoes)}</Num>
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{formatInt(r.national.brancos)}</Num>
                  </TableCell>
                  <TableCell className="text-right">
                    <Num>{formatInt(r.national.nulos)}</Num>
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P9 · Quanto pesa cada lugar? -----------------------------------------------------------

export function Weight() {
  return <WithHistory>{(m) => <WeightInner m={m} />}</WithHistory>;
}

function WeightInner({ m }: { m: HistoryModel }) {
  const year = m.years.at(-1)!;
  const r = m.first(year);
  const ufs = Object.entries(r.byUf)
    .map(([uf, t]) => ({ uf, aptos: t.aptos }))
    .sort((a, b) => b.aptos - a.aptos);
  const big = m.file.aptos.reduce<number>((best, a, i) => ((a ?? 0) > (m.file.aptos[best] ?? 0) ? i : best), 0);
  const city = m.file.aptos[big]!;
  const smaller = ufs.filter((u) => u.aptos < city).length;
  const asc = m.file.aptos
    .map((a, i) => ({ a: a ?? 0, i }))
    .filter((x) => x.a > 0)
    .sort((x, y) => x.a - y.a);
  let acc = 0,
    count = 0;
  for (const x of asc) {
    if (acc >= city) break;
    acc += x.a;
    count++;
  }
  const max = ufs[0]!.aptos;

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        {placeName(m, big)} tinha <Num>{formatInt(city)}</Num> eleitores em {year}, mais do que{" "}
        <Calc how="Estados com menos eleitores aptos do que a cidade.">{smaller}</Calc> dos {ufs.length} estados, e tantos quanto os{" "}
        <Calc how="Somando os municípios do menor para o maior até alcançar a cidade.">{formatInt(count)}</Calc> menores municípios do país juntos. O
        menor, {placeName(m, asc[0]!.i)}, tinha <Num>{formatInt(asc[0]!.a)}</Num>.
      </Answer>
      <div
        className="flex flex-col gap-0.5"
        role="img"
        aria-label={`Eleitores aptos por estado em ${year}, com a linha da cidade de ${placeName(m, big)}. A tabela traz os números.`}
      >
        {ufs.map((u) => (
          <div key={u.uf} className="relative grid grid-cols-[2.5rem_1fr] items-center gap-2 text-xs">
            <span className="font-mono font-semibold" title={ufName(u.uf)}>
              {u.uf}
            </span>
            <div className="relative h-3">
              <div className="h-3 rounded-r-sm bg-ink-2/60" style={{ width: `${(u.aptos / max) * 100}%` }} />
              <div aria-hidden className="absolute top-[-2px] bottom-[-2px] w-px bg-pt" style={{ left: `${(city / max) * 100}%` }} />
            </div>
          </div>
        ))}
        <p className="mt-1 text-xs text-ink-2">
          <span aria-hidden className="mr-1 inline-block h-3 w-px bg-pt align-middle" /> a cidade de {placeName(m, big)}
        </p>
      </div>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Eleitores aptos ({year})</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ufs.map((u) => (
              <TableRow key={u.uf}>
                <TableCell>{ufName(u.uf)}</TableCell>
                <TableCell className="text-right">
                  <Num>{formatInt(u.aptos)}</Num>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}

// --- P10 · E os brasileiros no exterior? ----------------------------------------------------

export function Abroad() {
  return <WithHistory>{(m) => <AbroadInner m={m} />}</WithHistory>;
}

function AbroadInner({ m }: { m: HistoryModel }) {
  const rows = m.years.map((y) => {
    const r = m.first(y);
    const k = r.candidates.findIndex((c) => c.party === "PT");
    return {
      y,
      r,
      ab: r.abroad,
      pt: r.abroad ? shareOf(r.abroad, k) : null,
      br: shareOf(r.national, k)!,
    };
  });
  const withAbroad = rows.filter((x) => x.ab);
  const [f, l] = [withAbroad[0]!, withAbroad.at(-1)!];
  const swing = withAbroad
    .slice(1)
    .map((x, k) => ({ x, d: Math.abs(x.pt! - withAbroad[k]!.pt!) }))
    .sort((a, b) => b.d - a.d)[0]!;

  return (
    <div className="flex flex-col gap-4">
      <Answer>
        Eram <Num>{formatInt(f.ab!.aptos)}</Num> eleitores no exterior em {f.y} e <Num>{formatInt(l.ab!.aptos)}</Num> em {l.y}. E eles mudam de lado
        mais do que o Brasil: o PT teve{" "}
        <Calc how="Fatia do PT nos válidos do exterior, 1º turno.">{pct(rows.find((x) => x.y === swing.x.y - 4)!.pt!)}</Calc> lá em {swing.x.y - 4} e{" "}
        <Calc how="Fatia do PT nos válidos do exterior, 1º turno.">{pct(swing.x.pt!)}</Calc> em {swing.x.y}.
      </Answer>
      <div className="max-w-2xl">
        <LineChart
          label="Fatia do PT no 1º turno: exterior e Brasil"
          x={rows.map((x) => String(x.y))}
          series={[
            {
              name: "Exterior",
              color: "var(--pt)",
              values: rows.map((x) => x.pt),
            },
            {
              name: "Brasil",
              color: "var(--ink-2)",
              values: rows.map((x) => x.br),
              dashed: true,
            },
          ]}
          yMax={0.6}
          ticks={[0, 0.2, 0.4, 0.6]}
          format={(v) => `${Math.round(v * 100)}%`}
          tip={(v) => pct(v)}
        />
      </div>
      <Method>
        <p>
          Votos do candidato do PT sobre os válidos, 1º turno, nas seções do exterior. Em {m.years[0]} o TSE não publica linhas separadas para o
          exterior. A diferença para o Brasil: {pp(l.pt! - l.br)} em {l.y}.
        </p>
      </Method>
      <TableDisclosure>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Eleição</TableHead>
              <TableHead className="text-right">Aptos no exterior</TableHead>
              <TableHead className="text-right">Comparecimento</TableHead>
              <TableHead className="text-right">PT no exterior</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((x) => (
              <TableRow key={x.y}>
                <TableCell className="font-mono">{x.y}</TableCell>
                <TableCell className="text-right">{x.ab ? <Num>{formatInt(x.ab.aptos)}</Num> : "sem dados separados"}</TableCell>
                <TableCell className="text-right">
                  {x.ab ? <Calc how="Comparecimento sobre aptos.">{pct(x.ab.comparecimento / x.ab.aptos)}</Calc> : "—"}
                </TableCell>
                <TableCell className="text-right">{x.pt === null ? "—" : <Calc how="Sobre os válidos do exterior.">{pct(x.pt)}</Calc>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}
