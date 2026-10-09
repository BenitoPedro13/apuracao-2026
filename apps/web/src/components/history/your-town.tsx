"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Calc, Num } from "@/components/num";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ViewError } from "@/components/view-error";
import {
  candidateName,
  pct,
  pp,
  POLE_COLOR,
  searchKey,
  shareOf,
  useHistoryMunicipality,
  useTownHistory,
  type HistoryModel,
  type TownRound,
} from "@/hooks/use-history";
import { formatInt } from "@/lib/format";
import { placeName, WithHistory } from "./with-history";

// P1, "Como a sua cidade votou desde 1994?" (TASK-historical-presidential.md §2.1).

const EXAMPLES = ["3523107", "2204550", "3550308", "5300108"]; // Itaquaquecetuba, Guaribas, São Paulo, Brasília

export function YourTown() {
  return <WithHistory>{(m) => <Town m={m} />}</WithHistory>;
}

function Town({ m }: { m: HistoryModel }) {
  const [ibge, setIbge] = useHistoryMunicipality();
  const i = ibge ? m.indexOf(ibge) : -1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MunicipalitySearch m={m} value={i} onChange={(j) => setIbge(m.file.ids[j]!)} />
        <span className="text-sm text-ink-2">ou veja</span>
        {EXAMPLES.map((id) => {
          const j = m.indexOf(id);
          return j < 0 ? null : (
            <Button key={id} variant="outline" size="sm" onClick={() => setIbge(id)} aria-pressed={i === j}>
              {placeName(m, j)}
            </Button>
          );
        })}
      </div>
      {i >= 0 ? (
        <TownRecord m={m} i={i} ibge={ibge!} onPick={(j) => setIbge(m.file.ids[j]!)} />
      ) : (
        <p className="max-w-[62ch] text-ink-2">
          Escolha um município para ver em quem ele votou em cada eleição, se escolheu o presidente eleito, como o voto no PT se compara ao do Brasil e quais
          cidades, às vezes em outro estado, votam do mesmo jeito.
        </p>
      )}
    </div>
  );
}

function MunicipalitySearch({ m, value, onChange }: { m: HistoryModel; value: number; onChange: (i: number) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const key = searchKey(q.trim());
  // 5,570 names: filter here (accents and case ignored), show the 30 best, largest first.
  const matches =
    key.length < 2
      ? []
      : m.file.name
          .map((n, i) => ({ i, k: searchKey(n) }))
          .filter((x) => x.k.includes(key))
          .sort((a, b) => Number(!a.k.startsWith(key)) - Number(!b.k.startsWith(key)) || (m.file.aptos[b.i] ?? 0) - (m.file.aptos[a.i] ?? 0))
          .slice(0, 30);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label={value >= 0 ? `Município: ${placeName(m, value)}. Trocar` : "Procure um município"} className="w-full max-w-80 justify-between sm:w-80">
          {value >= 0 ? placeName(m, value) : "Procure um município…"}
          <ChevronsUpDown aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Nome do município" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{key.length < 2 ? "Digite ao menos duas letras." : "Nenhum município com esse nome."}</CommandEmpty>
            <CommandGroup>
              {matches.map(({ i }) => (
                <CommandItem
                  key={i}
                  value={String(i)}
                  onSelect={() => {
                    onChange(i);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <Check aria-hidden className={i === value ? "opacity-100" : "opacity-0"} />
                  {placeName(m, i)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TownRecord({ m, i, ibge, onPick }: { m: HistoryModel; i: number; ibge: string; onPick: (j: number) => void }) {
  const { data, error, isLoading } = useTownHistory(m, ibge);
  if (isLoading) return <Skeleton className="h-80" aria-label="Carregando o município" />;
  if (!data) return error ? <ViewError what="o município" error={error} stale={false} /> : null;

  const decisive = data.filter((r) => r.decisive && r.candidates.length);
  const picked = decisive.filter((r) => r.pickedWinner === true).length;
  const counted = decisive.filter((r) => r.pickedWinner !== null).length;
  const firsts = data.filter((r) => r.round === 1 && r.candidates.length);
  const ptVsBrazil = firsts.map((r) => {
    const here = r.candidates.find((c) => c.pole === "pt")?.share ?? 0;
    const nat = m.first(r.year);
    const k = nat.candidates.findIndex((c) => c.party === "PT");
    return { year: r.year, d: here - shareOf(nat.national, k)! };
  });
  const morePt = ptVsBrazil.filter((x) => x.d > 0).length;
  const firstYear = data.find((r) => r.aptos !== null);
  const last = data.at(-1)!;
  const similar = m.file.insights.similar[i] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-bold">{placeName(m, i)}</h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Fact
          value={`${picked} de ${counted}`}
          how="Turnos decisivos em que o mais votado aqui foi o eleito; empates exatos não contam."
          label={`eleições em que a cidade votou em quem foi eleito presidente${counted < 8 ? ` (votou em ${counted})` : ""}`}
        />
        <Fact
          value={`${morePt} de ${ptVsBrazil.length}`}
          how="1º turno: a fatia do candidato do PT aqui comparada à do Brasil."
          label="eleições em que votou mais no PT do que o Brasil"
        />
        {firstYear && last.aptos !== null && firstYear.aptos !== null && (
          <Fact
            value={firstYear.year === last.year ? formatInt(last.aptos) : `${formatInt(firstYear.aptos)} → ${formatInt(last.aptos)}`}
            how="Eleitores aptos no arquivo do TSE, na primeira e na última eleição."
            label={`eleitores, ${firstYear.year} → ${last.year}`}
            tse
          />
        )}
      </ul>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Eleição</TableHead>
              <TableHead>Mais votado aqui</TableHead>
              <TableHead className="text-right">Vantagem</TableHead>
              <TableHead>Eleito no Brasil</TableHead>
              <TableHead className="text-right">PT aqui × Brasil (1º turno)</TableHead>
              <TableHead className="text-right">Comparecimento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {m.years.map((y) => {
              const r = data.find((x) => x.year === y && x.decisive)!;
              const r1 = data.find((x) => x.year === y && x.round === 1)!;
              return <YearRow key={y} m={m} r={r} r1={r1} pv={ptVsBrazil.find((x) => x.year === y)?.d ?? null} />;
            })}
          </TableBody>
        </Table>
      </div>

      {similar.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="font-semibold">Cidades que votam como {placeName(m, i)}</span>{" "}
            <span className="text-ink-2">(o voto no PT, comparado ao do Brasil, subiu e desceu junto em todas as eleições):</span>
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {similar.map((j) => (
              <li key={j}>
                <Button variant="outline" size="sm" onClick={() => onPick(j)}>
                  {placeName(m, j)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Fact({ value, label, how, tse = false }: { value: string; label: string; how: string; tse?: boolean }) {
  return (
    <li className="flex flex-col gap-1 border-t-2 border-ink pt-2">
      {tse ? (
        <Num className="text-2xl font-semibold">{value}</Num>
      ) : (
        <Calc how={how} className="text-2xl font-semibold">
          {value}
        </Calc>
      )}
      <span className="text-sm text-ink-2">{label}</span>
    </li>
  );
}

function YearRow({ m, r, r1, pv }: { m: HistoryModel; r: TownRound; r1: TownRound; pv: number | null }) {
  const nat = m.decisive(r.year);
  const elected = nat.candidates[0]!;
  if (!r.candidates.length) {
    return (
      <TableRow>
        <TableCell className="font-mono">{r.year}</TableCell>
        <TableCell colSpan={5} className="text-ink-2">
          Não era município nesta eleição.
        </TableCell>
      </TableRow>
    );
  }
  const [a, b] = r.candidates;
  const tie = b && a!.votes === b.votes;
  return (
    <TableRow>
      <TableCell className="font-mono">
        {r.year}
        {r.round === 2 && <span className="text-ink-2"> 2ºT</span>}
      </TableCell>
      <TableCell>
        {tie ? (
          <span>
            Empate exato: {formatInt(a!.votes)} × {formatInt(b.votes)}
          </span>
        ) : (
          <>
            <span className="font-medium">{candidateName(a!.c)}</span>{" "}
            <span className="text-xs font-medium" style={{ color: POLE_COLOR[a!.pole] }}>
              {a!.c.party}
            </span>{" "}
            <Calc how="Votos sobre os válidos do município." className="text-ink-2">
              {pct(a!.share)}
            </Calc>
          </>
        )}
      </TableCell>
      <TableCell className="text-right">
        {b && !tie ? <Calc how="Diferença entre o 1º e o 2º colocados, sobre os válidos.">{pp(a!.share - b.share).replace("+", "")}</Calc> : "—"}
      </TableCell>
      <TableCell>
        {/* A mark, not only weight or colour, says whether the town chose the president. */}
        <span aria-hidden className="mr-1.5 inline-block w-3 font-mono">
          {r.pickedWinner === true ? "✓" : r.pickedWinner === false ? "✗" : ""}
        </span>
        <span className={r.pickedWinner ? "font-medium" : "text-ink-2"}>
          {candidateName(elected)} <span className="text-xs">{elected.party}</span>
        </span>
        {r.pickedWinner !== null && <span className="sr-only">{r.pickedWinner ? " (a cidade votou no eleito)" : " (a cidade votou em outro)"}</span>}
      </TableCell>
      <TableCell className="text-right">
        {pv === null ? "—" : <Calc how="1º turno: fatia do candidato do PT aqui menos a do Brasil.">{pp(pv)}</Calc>}
      </TableCell>
      <TableCell className="text-right">
        {r1.aptos && r1.comparecimento !== null ? <Calc how="Comparecimento sobre aptos, 1º turno.">{pct(r1.comparecimento / r1.aptos)}</Calc> : "—"}
      </TableCell>
    </TableRow>
  );
}
