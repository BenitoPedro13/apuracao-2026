"use client";

import { Button } from "@/components/ui/button";
import { useSelectedRound } from "@/hooks/use-data";

/** "1º turno" / "2º turno": only the rounds the epochs index lists (§2.3). */
export function RoundSelector() {
  const { rounds, selected, select } = useSelectedRound();
  if (rounds.length < 2 || !selected) return null;
  return (
    <div role="group" aria-label="Turno" className="flex gap-1">
      {rounds.map((r) => (
        <Button
          key={r.epoch}
          variant={r.epoch === selected.epoch ? "secondary" : "outline"}
          size="sm"
          aria-pressed={r.epoch === selected.epoch}
          onClick={() => select(r.epoch)}
        >
          {r.label}
          {r.live && rounds.some((o) => !o.live) ? " (atual)" : ""}
        </Button>
      ))}
    </div>
  );
}
