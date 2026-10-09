"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import {
  LegislativeBrView,
  LegislativeUfView,
  MapIndexView,
  MapView,
  MunicipalityView,
  RegionsView,
  ResultView,
  type LegislativeOffice,
  type Manifest,
  type Office,
} from "@apuracao/contracts";
import type { z } from "zod";
import { epochsQuery, manifestQuery, pointerPollingQuery, pointerQuery, viewQuery } from "@/data/queries";
import { firstRoundRef, resolveRounds } from "@/data/rules";
import { useRoundParam } from "./use-url-state";

// Every data access goes through these hooks (global frontend rules). The chain is
// pointer → round → manifest → view; TanStack keeps the last good data on any error.

/** Reads the pointer from the cache; the fetching is usePointerPolling's job. */
export function usePointer() {
  return useQuery(pointerQuery());
}

/** Mounted once, in the providers: the only observer that polls the pointer. */
export function usePointerPolling() {
  useQuery(pointerPollingQuery());
}

/** The rounds offered and the one shown (TASK-web-shell-and-data-hooks.md §2.3). */
export function useSelectedRound() {
  const [requested, setRequested] = useRoundParam();
  const pointer = usePointer();
  const epochs = useQuery(epochsQuery());
  const p = pointer.data?.pointer;
  const liveManifest = useQuery({
    ...manifestQuery(p ? { epoch: p.epoch, seq: p.seq, sha: p.manifest } : { epoch: "", seq: 0, sha: "" }),
    enabled: !!p,
  });
  // Wait for the index's first answer (it's tiny) so a ?turno link doesn't flash the live round.
  const resolved =
    p && !epochs.isPending
      ? resolveRounds(p, epochs.data ?? null, requested, liveManifest.data?.elections.president)
      : null;
  return {
    rounds: resolved?.rounds ?? [],
    selected: resolved?.selected ?? null,
    select: (epoch: string) => setRequested(resolved?.rounds.find((r) => r.live)?.epoch === epoch ? null : epoch),
    error: pointer.error,
  };
}

export function useManifest() {
  const { selected } = useSelectedRound();
  const ref = selected?.ref;
  return useQuery({
    ...manifestQuery(ref ?? { epoch: "", seq: 0, sha: "" }),
    enabled: !!ref,
    // Keep showing the previous seq of the same round while the next one loads.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === ref?.epoch ? prev : undefined),
  });
}

export interface ViewState<T> {
  data: T | undefined;
  error: Error | null;
  /** First load, nothing to show yet. */
  isLoading: boolean;
  /** The manifest has no such view (e.g. no governor runoff in this UF). Not an error. */
  absent: boolean;
}

function useView<S extends z.ZodType>(name: string | null, schema: S): ViewState<z.infer<S>> {
  return useViewIn(useManifest(), name, schema);
}

function useViewIn<S extends z.ZodType>(
  manifest: { data?: Manifest; error: Error | null },
  name: string | null,
  schema: S,
): ViewState<z.infer<S>> {
  const sha = name ? manifest.data?.views[name] : undefined;
  const q = useQuery({
    ...viewQuery(name ?? "", sha ?? "", schema),
    enabled: !!sha,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === name ? prev : undefined),
  });
  const absent = !!name && !!manifest.data && !sha;
  return {
    data: q.data,
    error: q.error ?? (q.data ? null : manifest.error),
    isLoading: !absent && q.data === undefined && !q.error && !manifest.error,
    absent,
  };
}

export const useResult = (office: Office, area: string) => useView(`result/${office}/${area}`, ResultView);
export const useRegions = () => useView("regions/president", RegionsView);
export const useMunicipalities = (office: Office, area: string | null) =>
  useView(area ? `municipalities/${office}/${area}` : null, MunicipalityView);
/** For TASK-map.md. */
export const useMapIndex = () => useView("map-index/president", MapIndexView);
export const useMapFrame = () => useView("map/president", MapView);

/** Several result views at once (the UF table's 27 + Exterior). Same caching as useResult. */
export function useResults(office: Office, areas: readonly string[]): ViewState<ResultView>[] {
  const manifest = useManifest();
  const results = useQueries({
    queries: areas.map((area) => {
      const name = `result/${office}/${area}`;
      const sha = manifest.data?.views[name];
      return {
        ...viewQuery(name, sha ?? "", ResultView),
        enabled: !!sha,
        placeholderData: (prev: ResultView | undefined, prevQuery?: { queryKey: readonly unknown[] }) =>
          prevQuery?.queryKey[1] === name ? prev : undefined,
      };
    }),
  });
  return results.map((q, i) => {
    const absent = !!manifest.data && !manifest.data.views[`result/${office}/${areas[i]}`];
    return {
      data: q.data,
      error: q.error ?? (q.data ? null : manifest.error),
      isLoading: !absent && q.data === undefined && !q.error && !manifest.error,
      absent,
    };
  });
}

/** The 1st round's manifest, whichever round is selected (TASK-legislative-archive.md §2.4). */
function useFirstRoundManifest() {
  const pointer = usePointer();
  const epochs = useQuery(epochsQuery());
  const p = pointer.data?.pointer;
  const liveManifest = useQuery({
    ...manifestQuery(p ? { epoch: p.epoch, seq: p.seq, sha: p.manifest } : { epoch: "", seq: 0, sha: "" }),
    enabled: !!p,
  });
  const ref = p && !epochs.isPending ? firstRoundRef(p, epochs.data ?? null, liveManifest.data?.elections.president) : null;
  const q = useQuery({ ...manifestQuery(ref ?? { epoch: "", seq: 0, sha: "" }), enabled: !!ref });
  return { data: q.data, error: q.error ?? pointer.error };
}

export const useLegislativeBr = (office: LegislativeOffice) =>
  useViewIn(useFirstRoundManifest(), `legislative/${office}/br`, LegislativeBrView);
export const useLegislativeUf = (office: LegislativeOffice, uf: string | null) =>
  useViewIn(useFirstRoundManifest(), uf ? `legislative/${office}/${uf}` : null, LegislativeUfView);
