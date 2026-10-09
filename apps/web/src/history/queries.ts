import { queryOptions } from "@tanstack/react-query";
import { HistoryFile, HistoryMunicipalities } from "@apuracao/contracts";
import { fetchVerified } from "@/data/fetch";
import { HISTORY_FILES } from "./history-file";

// The presidential archive ships with the site, content-addressed (TASK-historical-
// presidential.md §2.2): immutable, so it's fetched once and never refetched.

export const historyQuery = () =>
  queryOptions({
    queryKey: ["history", HISTORY_FILES.main.sha256] as const,
    queryFn: ({ signal }) => fetchVerified(`/${HISTORY_FILES.main.path}`, HISTORY_FILES.main.sha256, HistoryFile, signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export type HistoryUf = keyof typeof HISTORY_FILES.municipalities;
export const isHistoryUf = (uf: string): uf is HistoryUf => uf in HISTORY_FILES.municipalities;

/** One UF's municipalities with every TSE number, for "Como a sua cidade votou". */
export const historyUfQuery = (uf: HistoryUf) => {
  const f = HISTORY_FILES.municipalities[uf];
  return queryOptions({
    queryKey: ["history-uf", f.sha256] as const,
    queryFn: ({ signal }) => fetchVerified(`/${f.path}`, f.sha256, HistoryMunicipalities, signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
};
