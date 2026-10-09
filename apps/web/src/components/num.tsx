import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Provenance as typography (TASK-visual-identity.md §2.2): every number the TSE publishes
// is set in the mono face; every number we compute also gets a dotted underline, says how
// it was computed on hover, and reads as "calculado" to screen readers.

/** A number as the TSE published it. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono", className)}>{children}</span>;
}

/** A number we computed from the TSE's files. `how` says how, in one sentence. */
export function Calc({ children, how, className }: { children: ReactNode; how: string; className?: string }) {
  return (
    <span className={cn("calc font-mono", className)} title={how}>
      {children}
      <span className="sr-only"> (calculado)</span>
    </span>
  );
}
