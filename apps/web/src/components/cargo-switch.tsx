"use client";

import type { ReactNode } from "react";
import { useCargo } from "@/hooks/use-url-state";

/** Shows the president's panels or the legislative archive; both are built on the server. */
export function CargoSwitch({ president, legislative }: { president: ReactNode; legislative: ReactNode }) {
  return useCargo() === "presidente" ? president : legislative;
}

/** The president-only header controls (round selector, Exterior toggle). */
export function PresidentOnly({ children }: { children: ReactNode }) {
  return useCargo() === "presidente" ? children : null;
}

/** On the legislative pages, in place of the round selector: the 2nd round elects neither. */
export function LegislativeOnlyNote() {
  return useCargo() === "presidente" ? null : <span className="text-sm text-ink-2">1º turno · resultado final</span>;
}
