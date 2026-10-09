"use client";

import type { LegislativeUfView } from "@apuracao/contracts";
import { X } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Confirma, isElectedSituation } from "@/components/confirma";
import { Calc, Num } from "@/components/num";
import { UnitStatus } from "@/components/unit-status";
import { ViewError } from "@/components/view-error";
import { Skeleton } from "@/components/ui/skeleton";
import {
  alternateRole,
  useChamber,
  useUfRace,
  type PartyRow,
} from "@/hooks/use-legislative";
import { useSelectedUf } from "@/hooks/use-url-state";
import {
  displayName,
  formatDateTime,
  formatInt,
  formatTsePct,
  pctNumber,
} from "@/lib/format";
import { AREAS, areaName } from "@/lib/places";

type Candidate = LegislativeUfView["candidates"][number];

const COUNT_HOW =
  "Contagem dos candidatos do partido marcados como eleitos no arquivo da UF.";
const TOTAL_HOW =
  "Votos nominais + votos de legenda do partido, ambos publicados pelo TSE.";

const partyColumns = (proportional: boolean): DataColumn<PartyRow>[] => [
  {
    id: "party",
    header: "Partido",
    cell: (r) => <span title={r.name}>{r.party}</span>,
    sortValue: (r) => r.party,
  },
  {
    id: "seats",
    header: "Eleitos",
    cell: (r) => <Calc how={COUNT_HOW}>{r.seats}</Calc>,
    sortValue: (r) => r.seats,
    numeric: true,
  },
  {
    id: "nominal",
    header: proportional ? "Votos nominais" : "Votos",
    cell: (r) => <Num>{formatInt(r.nominal)}</Num>,
    sortValue: (r) => r.nominal,
    numeric: true,
  },
  ...(proportional
    ? [
        {
          id: "label",
          header: "Legenda",
          cell: (r: PartyRow) => <Num>{formatInt(r.label ?? 0)}</Num>,
          sortValue: (r: PartyRow) => r.label ?? 0,
          numeric: true,
        },
        {
          id: "total",
          header: "Total",
          cell: (r: PartyRow) => (
            <Calc how={TOTAL_HOW}>{formatInt(r.totalCalc)}</Calc>
          ),
          sortValue: (r: PartyRow) => r.totalCalc,
          numeric: true,
        },
      ]
    : []),
];

const candidateColumns = (senate: boolean): DataColumn<Candidate>[] => [
  {
    id: "name",
    header: "Candidato",
    cell: (c) => (
      <span className={c.elected ? "font-semibold" : undefined}>
        {displayName(c.name)}{" "}
        <span className="font-normal text-ink-2">{c.n}</span>
        {senate && c.elected && c.alternates.length > 0 && (
          <span className="block text-xs font-normal text-ink-2">
            {c.alternates
              .map((a) => `${alternateRole(a.role)}: ${displayName(a.name)}`)
              .join(" · ")}
          </span>
        )}
      </span>
    ),
    sortValue: (c) => c.name,
  },
  {
    id: "party",
    header: "Partido",
    cell: (c) => c.party,
    sortValue: (c) => c.party,
  },
  {
    id: "votes",
    header: "Votos",
    cell: (c) => <Num>{formatInt(c.votes)}</Num>,
    sortValue: (c) => c.votes,
    numeric: true,
  },
  {
    id: "pct",
    header: "%",
    cell: (c) => <Num>{formatTsePct(c.pct)}</Num>,
    sortValue: (c) => pctNumber(c.pct),
    numeric: true,
  },
  {
    id: "situation",
    header: "Situação",
    cell: (c) => (
      <span className={c.elected ? "font-semibold" : "text-ink-2"}>
        {isElectedSituation(c.situation) ? <Confirma>{c.situation}</Confirma> : c.situation}
        {c.destination && c.destination !== "Válido" && (
          <span className="block text-xs font-normal text-warn">
            {c.destination}
          </span>
        )}
      </span>
    ),
    sortValue: (c) => c.situation,
  },
];

/** One UF's race: the TSE's own totals, the parties, and who was elected (§2.4). */
export function UfRace() {
  const chamber = useChamber();
  const [uf, setUf] = useSelectedUf();
  const area = uf && AREAS.includes(uf) && uf !== "zz" ? uf : null;
  const { view, parties, candidates } = useUfRace(
    chamber?.office ?? "federal-deputy",
    area,
  );
  if (!chamber) return null;

  const picker = (
    <div className="flex flex-wrap items-center justify-between gap-2">
    <label className="flex items-center gap-2 text-sm">
      <span>Estado</span>
      <select
        value={area ?? ""}
        onChange={(e) => setUf(e.target.value || null)}
        className="h-8 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <option value="">Escolha…</option>
        {AREAS.filter((a) => a !== "zz").map((a) => (
          <option key={a} value={a}>
            {areaName(a)}
          </option>
        ))}
      </select>
    </label>
    <Button variant="outline" size="sm" onClick={() => setUf(null)}>
      <X aria-hidden />
      Fechar
    </Button>
    </div>
  );

  const v = view.data;
  let body;
  if (!area)
    body = (
      <p className="text-sm text-ink-2">
        Escolha um estado para ver os eleitos e os votos por partido.
      </p>
    );
  else if (view.error && !v)
    body = (
      <ViewError
        what={`a disputa em ${areaName(area)}`}
        error={view.error}
        stale={false}
      />
    );
  else if (!v)
    body = view.absent ? (
      <p className="text-sm text-ink-2">Ainda não publicado.</p>
    ) : (
      <Skeleton className="h-64" aria-label="Carregando a disputa" />
    );
  else if (v.seats === null)
    body = <UnitStatus status={v.status} failingSince={v.failingSince} />;
  else {
    body = (
      <div className="flex flex-col gap-4">
        {view.error && (
          <ViewError
            what={`a disputa em ${areaName(area)}`}
            error={view.error}
            stale
          />
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-2">Vagas</dt>
            <dd className="font-mono text-lg">{formatInt(v.seats)}</dd>
          </div>
          {v.quotient !== null && (
            <div>
              <dt className="text-ink-2">Quociente eleitoral</dt>
              <dd className="font-mono text-lg">{formatInt(v.quotient)}</dd>
            </div>
          )}
          {v.votes && (
            <div>
              <dt className="text-ink-2">Votos válidos</dt>
              <dd className="font-mono text-lg">{formatInt(v.votes.valid)}</dd>
            </div>
          )}
          {v.electorate && (
            <div>
              <dt className="text-ink-2">Comparecimento</dt>
              <dd className="font-mono text-lg">
                {formatTsePct(v.electorate.turnoutPct)}
              </dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-ink-2">
          {v.officeName}.{" "}
          <UnitStatus
            status={v.status}
            countedPct={v.sections?.countedPct}
            failingSince={v.failingSince}
          />
          {v.tse?.totalizedAt && (
            <> · totalizado pelo TSE em {formatDateTime(v.tse.totalizedAt)}</>
          )}
        </p>
        {/* Proportional seats are won by parties, so they lead; the senate's few candidates lead there. */}
        {chamber.proportional ? (
          <>
            <div className="overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold">Por partido</h3>
              <DataTable
                rows={parties}
                columns={partyColumns(chamber.proportional)}
                caption={`${v.officeName}, ${areaName(area)}: eleitos e votos por partido.`}
                rowId={(p) => p.party}
                initialSort={[{ id: "seats", desc: true }]}
              />
            </div>
            <div className="overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold">
                {chamber.proportional ? "Eleitos" : "Candidatos"}
              </h3>
              <DataTable
                rows={candidates}
                columns={candidateColumns(!chamber.proportional)}
                caption={`${v.officeName}, ${areaName(area)}: ${chamber.proportional ? "eleitos" : "candidatos"} por votos.`}
                rowId={(c) => c.n}
                initialSort={[{ id: "votes", desc: true }]}
              />
            </div>
          </>
        ) : (
          <>
            <div className="overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold">
                {chamber.proportional ? "Eleitos" : "Candidatos"}
              </h3>
              <DataTable
                rows={candidates}
                columns={candidateColumns(!chamber.proportional)}
                caption={`${v.officeName}, ${areaName(area)}: ${chamber.proportional ? "eleitos" : "candidatos"} por votos.`}
                rowId={(c) => c.n}
                initialSort={[{ id: "votes", desc: true }]}
              />
            </div>
            <div className="overflow-x-auto">
              <h3 className="mb-1 text-sm font-semibold">Por partido</h3>
              <DataTable
                rows={parties}
                columns={partyColumns(chamber.proportional)}
                caption={`${v.officeName}, ${areaName(area)}: eleitos e votos por partido.`}
                rowId={(p) => p.party}
                initialSort={[{ id: "seats", desc: true }]}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {picker}
      {body}
    </div>
  );
}
