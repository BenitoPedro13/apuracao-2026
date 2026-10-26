import { queryOptions } from "@tanstack/react-query";
import { CountTimeline } from "@apuracao/contracts";
import { fetchVerified } from "@/data/fetch";
import { COUNT_TIMELINE_FILES } from "./timeline-files";

// "Ao longo da apuração" ships with the site, content-addressed like the history files
// (TASK-over-the-count.md §2.2): immutable, fetched once.

export type CountTimelineId = keyof typeof COUNT_TIMELINE_FILES;
export const isCountTimelineId = (id: string): id is CountTimelineId => id in COUNT_TIMELINE_FILES;

export const countTimelineQuery = (id: CountTimelineId) => {
  const f = COUNT_TIMELINE_FILES[id];
  return queryOptions({
    queryKey: ["count-timeline", f.sha256] as const,
    queryFn: ({ signal }) => fetchVerified(`/${f.path}`, f.sha256, CountTimeline, signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
};
