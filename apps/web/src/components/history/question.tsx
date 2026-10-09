import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The history page's unit (TASK-historical-presidential.md §2.1): the question a reader
// would ask, a one-sentence answer with its number, the chart, how we computed it, and the
// numbers as a table (invariant 7). Server components: the frame is static HTML.

export function Question({
  id,
  eyebrow,
  title,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("flex min-w-0 scroll-mt-4 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6", className)}
    >
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-xs font-semibold tracking-wider text-ink-2 uppercase">{eyebrow}</p>
        <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight text-balance sm:text-2xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** The answer, before any chart: the sentence a reader takes away. */
export function Answer({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] text-lg leading-snug text-pretty">{children}</p>;
}

/** "Como calculamos": the method in plain words. */
export function Method({ children }: { children: ReactNode }) {
  return (
    <details className="max-w-[72ch] text-sm text-ink-2">
      <summary className="cursor-pointer font-medium text-ink">Como calculamos</summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

/** The chart's numbers as a table, folded away (the map and charts are never the only way in). */
export function TableDisclosure({ label = "Ver os números em tabela", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">{label}</summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

/** A small year/option switcher: buttons with aria-pressed. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = String,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "h-8 rounded-md border px-2.5 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            o === value ? "border-ink bg-ink text-paper" : "border-line bg-panel hover:bg-secondary",
          )}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}
