"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSelectedRound } from "@/hooks/use-data";

/** "1º turno" / "2º turno": only the rounds the epochs index lists (§2.3). */
export function RoundSelector() {
  const { rounds, selected, select } = useSelectedRound();
  if (rounds.length < 2 || !selected) return null;
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label="Turno"
      value={selected.epoch}
      onValueChange={(epoch) => epoch && select(epoch)}
    >
      {rounds.map((r) => (
        <ToggleGroupItem key={r.epoch} value={r.epoch}>
          {r.label}
          {r.live && rounds.some((o) => !o.live) ? " (atual)" : ""}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
