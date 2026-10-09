"use client";

import type { ReactNode } from "react";
import { useCargo } from "@/hooks/use-url-state";

/** Shows the page of the chosen office; all three are built on the server. */
export function CargoSwitch({ president, governor, legislative }: { president: ReactNode; governor: ReactNode; legislative: ReactNode }) {
  const cargo = useCargo();
  return cargo === "presidente" ? president : cargo === "governador" ? governor : legislative;
}

/** The president-only header controls (the Exterior toggle). */
export function PresidentOnly({ children }: { children: ReactNode }) {
  return useCargo() === "presidente" ? children : null;
}

/** The offices voted in both rounds (president, governor) get the round selector. */
export function RoundOffices({ children }: { children: ReactNode }) {
  const cargo = useCargo();
  return cargo === "presidente" || cargo === "governador" ? children : null;
}

/** On the legislative pages, in place of the round selector: the 2nd round elects neither. */
export function LegislativeOnlyNote() {
  const cargo = useCargo();
  return cargo === "presidente" || cargo === "governador" ? null : <span className="text-sm text-ink-2">1º turno · resultado final</span>;
}
