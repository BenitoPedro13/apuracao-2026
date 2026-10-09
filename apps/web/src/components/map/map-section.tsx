"use client";

import dynamic from "next/dynamic";
import { MapSkeleton } from "./map-skeleton";

// The map is its own chunk, outside the first load (TASK-map.md §2.5): d3-zoom,
// topojson-client and the renderer download after the headline is on screen.
export const MapSection = dynamic(() => import("./map-panel"), { ssr: false, loading: () => <MapSkeleton /> });
