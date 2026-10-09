import { queryOptions } from "@tanstack/react-query";
import { fetchVerified } from "@/data/fetch";
import { GEO_FILE } from "./geo-file";
import { decodeGeometry, GeoFile } from "./geometry";

// The geometry ships with the site (TASK-map.md §2.1), content-hashed and checked like
// every view. In the map's own module so topojson-client stays out of the first load.

export const geometryUrl = `/${GEO_FILE.path}`;

export const geometryQuery = () =>
  queryOptions({
    queryKey: ["geometry", GEO_FILE.sha256] as const,
    queryFn: async ({ signal }) => decodeGeometry(await fetchVerified(geometryUrl, GEO_FILE.sha256, GeoFile, signal)),
    staleTime: Infinity,
    gcTime: Infinity,
  });
