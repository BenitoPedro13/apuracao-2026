"use client";

import dynamic from "next/dynamic";
import { MapSkeleton } from "./map-skeleton";

// The per-UF maps share the president map's lazy chunk boundary (TASK-map.md §2.5): the
// renderer, d3-zoom and topojson-client load after the page's first paint.
export const UfMapSection = dynamic(() => import("./uf-map-panel"), { ssr: false, loading: () => <MapSkeleton /> });
