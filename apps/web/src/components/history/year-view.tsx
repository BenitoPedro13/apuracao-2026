"use client";

import { useState } from "react";
import { Calc, Num } from "@/components/num";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { candidateName, perMille, pct, POLE_COLOR, shareOf, useHistoryYear, validOf, type HistoryModel } from "@/hooks/use-history";
import { formatInt } from "@/lib/format";
import { UF_NAMES } from "@/lib/places";
import { marginStep, type FillToken } from "@/map/style";
import { HistoryMap } from "./history-map";
import { Segmented, TableDisclosure } from "./question";
import { placeName, WithHistory } from "./with-history";

// Any election since 1994 on the dashboard (TASK-historical-presidential.md §2.1, year view):
// the national result, who won each municipality in the decisive round, and the states.

const HOW_SHARE = "Votos do candidato sobre a soma dos votos de todos os candidatos (válidos), somados nos arquivos do TSE.";

export function YearView() {
  return <WithHistory h="h-[36rem]">{(m) => <Year m={m} />}</WithHistory>;
}

function Year({ m }: { m: HistoryModel }) {
  const [year, setYear] = useHistoryYear(m.years);
  const rounds = m.roundsOf(year);
  const [roundNo, setRoundNo] = useState<1 | 2 | null>(null);
  const round = rounds.find((r) => r.round === roundNo) ?? m.decisive(year);
  const k = m.years.indexOf(year);
  const dec = m.file.insights.decisive[k]!;
  const decisive = m.decisive(year);
  const n = round.national;
  const valid = validOf(n);
  const shown = round.candidates.map((c, i) => ({ c, i, share: shareOf(n, i)! })).filter((x, j) => j < 4 || x.share >= 0.01);
  const rest = round.candidates.length - shown.length;

  const tokenOf = (i: number): FillToken | null => {
    const w = dec.winner[i];
    const mg = dec.marginPm[i];
    if (w === null || w === undefined || mg === null || mg === undefined) return null;
    if (w === -1) return "other-1";
    const pole = m.pole(decisive, w);
    return `${pole === "rival" ? "pl" : pole === "pt" ? "pt" : "other"}-${marginStep(mg * 10)}`;
  };
  const describe = (i: number) => {
    const w = dec.winner[i];
    const mg = dec.marginPm[i];
    if (w === null || w === undefined || mg === null || mg === undefined) return `${placeName(m, i)}\nnão era município em ${year}`;
    if (w === -1) return `${placeName(m, i)}\nempate exato em ${year}`;
    return `${placeName(m, i)}\n${candidateName(decisive.candidates[w]!)} (${decisive.candidates[w]!.party}) venceu por ${pct(perMille(mg))} dos válidos`;
  };
  const [a, b] = [decisive.candidates[0]!, decisive.candidates[1]!];
  const ufs = Object.entries(round.byUf).sort(([x], [y]) => UF_NAMES[x.toLowerCase()]!.localeCompare(UF_NAMES[y.toLowerCase()]!, "pt-BR"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Ano da eleição" options={m.years} value={year} onChange={(y) => (setYear(y), setRoundNo(null))} />
        {rounds.length > 1 && (
          <Segmented
            label="Turno"
            options={rounds.map((r) => r.round)}
            value={round.round}
            onChange={(r) => setRoundNo(r)}
            format={(r) => `${r}º turno`}
          />
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ol className="flex flex-col gap-3">
            {shown.map(({ c, i, share }) => (
              <li key={c.n} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">
                    {candidateName(c)}{" "}
                    <span className="text-sm font-medium" style={{ color: POLE_COLOR[m.pole(round, i)] }}>
                      {c.party} {c.n}
                    </span>
                  </p>
                  <Calc how={HOW_SHARE} className="text-lg font-semibold">
                    {pct(share)}
                  </Calc>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${share * 100}%`,
                      background: POLE_COLOR[m.pole(round, i)],
                    }}
                  />
                </div>
                <p className="text-xs text-ink-2">
                  <Num>{formatInt(n.votes[i]!)}</Num> votos
                </p>
              </li>
            ))}
          </ol>
          {rest > 0 && <p className="text-xs text-ink-2">e mais {rest} candidatos com menos de 1% cada (na tabela por estado, somados).</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-2">Eleitores aptos</dt>
            <dd className="text-right">
              <Num>{formatInt(n.aptos)}</Num>
            </dd>
            <dt className="text-ink-2">Comparecimento</dt>
            <dd className="text-right">
              <Calc how="Comparecimento sobre eleitores aptos.">{pct(n.comparecimento / n.aptos)}</Calc>
            </dd>
            <dt className="text-ink-2">Brancos</dt>
            <dd className="text-right">
              <Num>{formatInt(n.brancos)}</Num>
            </dd>
            <dt className="text-ink-2">Nulos</dt>
            <dd className="text-right">
              <Num>{formatInt(n.nulos)}</Num>
            </dd>
            <dt className="text-ink-2">Votos válidos</dt>
            <dd className="text-right">
              <Num>{formatInt(valid)}</Num>
            </dd>
          </dl>
          <p className="text-xs text-ink-2">
            Resultado final. A contagem ao longo da noite não foi registrada para {year}: só existe a partir de 2026.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-semibold">
            Quem venceu em cada município
            {decisive.round === 2 ? ", no 2º turno" : ""}
          </h3>
          <HistoryMap
            m={m}
            styleKey={`year-${year}`}
            tokenOf={tokenOf}
            describe={describe}
            summary={`Mapa: vencedor em cada município em ${year}, ${candidateName(a)} em vermelho ou azul conforme o lado, mais escuro quanto maior a vantagem. A tabela por estado traz os números.`}
            legend={[
              {
                token: m.pole(decisive, 0) === "pt" ? "pt-4" : "pl-4",
                label: `${candidateName(a)} (${a.party})`,
              },
              {
                token: m.pole(decisive, 1) === "pt" ? "pt-4" : "pl-4",
                label: `${candidateName(b)} (${b.party})`,
              },
              { token: "other-3", label: "outro candidato" },
              { token: "absent", label: "não era município" },
            ]}
          />
          <p className="text-xs text-ink-2">Tons: vantagem de até 10, 25, 45 e mais de 45 pontos.</p>
        </div>
      </div>

      <TableDisclosure label={`Ver por estado (${round.round}º turno de ${year})`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estado</TableHead>
              {round.candidates.slice(0, 2).map((c) => (
                <TableHead key={c.n} className="text-right">
                  {candidateName(c)}
                </TableHead>
              ))}
              {round.candidates.length > 2 && <TableHead className="text-right">Outros</TableHead>}
              <TableHead className="text-right">Aptos</TableHead>
              <TableHead className="text-right">Comparecimento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ufs.map(([uf, t]) => {
              const v = validOf(t);
              const others = t.votes.slice(2).reduce((s, x) => s + x, 0);
              return (
                <TableRow key={uf}>
                  <TableCell>{UF_NAMES[uf.toLowerCase()]}</TableCell>
                  {[0, 1].map((c) => (
                    <TableCell key={c} className="text-right">
                      <Num>{formatInt(t.votes[c]!)}</Num>{" "}
                      <Calc how={HOW_SHARE} className="text-ink-2">
                        {pct(t.votes[c]! / v)}
                      </Calc>
                    </TableCell>
                  ))}
                  {round.candidates.length > 2 && (
                    <TableCell className="text-right">
                      <Calc how="Soma dos votos dos demais candidatos.">{formatInt(others)}</Calc>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Num>{formatInt(t.aptos)}</Num>
                  </TableCell>
                  <TableCell className="text-right">
                    <Calc how="Comparecimento sobre eleitores aptos.">{pct(t.comparecimento / t.aptos)}</Calc>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableDisclosure>
    </div>
  );
}
