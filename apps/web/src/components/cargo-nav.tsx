"use client";

import Link from "next/link";
import { CARGOS, useCargo, type Cargo } from "@/hooks/use-url-state";
import { cn } from "@/lib/utils";

const LABELS: Record<Cargo, string> = {
  presidente: "Presidente",
  governador: "Governadores",
  senado: "Senado",
  camara: "Câmara",
  assembleias: "Assembleias",
};

/**
 * Which office the page shows (TASK-legislative-archive.md §2.4). Plain links: each is a
 * shareable view of the page, and back/forward work. On the plan-B bucket a new route
 * wouldn't resolve, so the office is a query parameter.
 */
export function CargoNav() {
  const current = useCargo();
  return (
    <nav aria-label="Cargo">
      <ul className="flex flex-wrap gap-1">
        {CARGOS.map((c) => (
          <li key={c}>
            <Link
              href={c === "presidente" ? { pathname: "/" } : { pathname: "/", query: { cargo: c } }}
              aria-current={c === current ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                c === current ? "bg-secondary text-secondary-foreground" : "text-ink-2 underline-offset-4 hover:underline",
              )}
            >
              {LABELS[c]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
