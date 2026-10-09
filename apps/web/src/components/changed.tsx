"use client";

import { useChanged } from "@/hooks/use-changed";
import { cn } from "@/lib/utils";

/** A TSE string that briefly lights up when a new update changes it (TASK-urna-number.md §2.3). */
export function Changed({ value, className }: { value: string; className?: string }) {
  const n = useChanged(value);
  // A new key restarts the CSS animation on every change.
  return (
    <span key={n} className={cn(n > 0 && "changed", className)}>
      {value}
    </span>
  );
}
