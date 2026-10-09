"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewError } from "@/components/view-error";
import { useHistory, type HistoryModel } from "@/hooks/use-history";
import { displayName } from "@/lib/format";

/** Renders `children` with the archive once it has loaded; a skeleton before, the error after. */
export function WithHistory({ children, h = "h-72" }: { children: (m: HistoryModel) => ReactNode; h?: string }) {
  const { data, error, isLoading } = useHistory();
  if (isLoading) return <Skeleton className={h} aria-label="Carregando o histórico" />;
  if (!data) return error ? <ViewError what="o histórico" error={error} stale={false} /> : null;
  return children(data);
}

/** "Itaquaquecetuba (SP)". */
export const placeName = (m: HistoryModel, i: number) => `${displayName(m.file.name[i]!)} (${m.file.uf[i]})`;
