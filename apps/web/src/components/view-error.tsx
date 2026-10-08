import { AlertTriangle } from "lucide-react";

/**
 * A view that failed to load. With last good data on screen it's a notice next to it;
 * without, it replaces the numbers. Never zeros (invariant 6).
 */
export function ViewError({ what, error, stale }: { what: string; error: Error; stale: boolean }) {
  return (
    <p role="status" className="flex items-start gap-2 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {stale
          ? `Não foi possível atualizar ${what}; mostrando os últimos dados recebidos.`
          : `Não foi possível carregar ${what}.`}{" "}
        <span className="opacity-80">({error.message})</span>
      </span>
    </p>
  );
}
