"use client";

import { useSearchParams } from "next/navigation";
import { MAP_MODES, type MapMode } from "@/map/style";

// Shareable UI state in the query string (?turno=…&uf=…&exterior=0). Native replaceState
// syncs with useSearchParams (Next.js "Native History API"); no navigation, no reload.
// Components using these must sit under a <Suspense> (static export prerendering).

function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const set = (value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value === null) next.delete(name);
    else next.set(name, value);
    const qs = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };
  return [params.get(name), set];
}

/** The requested round's epoch; null = follow the live pointer. */
export const useRoundParam = () => useUrlParam("turno");

/** The UF whose municipalities are listed (two lowercase letters, or "zz" for abroad). */
export function useSelectedUf(): [string | null, (uf: string | null) => void] {
  const [uf, setUf] = useUrlParam("uf");
  return [uf && /^[a-z]{2}$/.test(uf) ? uf : null, setUf];
}

/** Whether abroad (Exterior) is included in the tables and the map. Default: shown. */
export function useShowExterior(): [boolean, (show: boolean) => void] {
  const [v, set] = useUrlParam("exterior");
  return [v !== "0", (show) => set(show ? null : "0")];
}

/** The map's mode (?mapa=); "lider" is the default and isn't written to the URL. */
export function useMapMode(): [MapMode, (mode: MapMode) => void] {
  const [v, set] = useUrlParam("mapa");
  const mode = MAP_MODES.find((m) => m === v) ?? "lider";
  return [mode, (m) => set(m === "lider" ? null : m)];
}

/** The municipality picked on the map (?mun=, its IBGE code), highlighted in the table. */
export function useSelectedMunicipality(): [string | null, (cdi: string | null) => void] {
  const [v, set] = useUrlParam("mun");
  return [v && /^\d{7}$/.test(v) ? v : null, set];
}

/** Sets several params in one history entry (choosing a municipality also chooses its UF). */
export function setUrlParams(values: Record<string, string | null>) {
  const next = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}
