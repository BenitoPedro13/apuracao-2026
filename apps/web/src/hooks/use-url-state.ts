"use client";

import { useSearchParams } from "next/navigation";

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
