import { Skeleton } from "@/components/ui/skeleton";

/** The map's exact box while it loads, so nothing shifts when it arrives. */
export function MapSkeleton() {
  return (
    <div className="@container">
      <div className="map-box relative" style={{ ["--map-aspect" as string]: "0.94" }}>
        <Skeleton className="absolute inset-0" />
        <p className="absolute inset-0 grid place-items-center text-sm text-ink-2">Carregando o mapa…</p>
      </div>
    </div>
  );
}
