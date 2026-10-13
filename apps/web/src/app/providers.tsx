"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/data/query-client";
import { usePointerPolling } from "@/hooks/use-data";
import { useHistoryMode } from "@/hooks/use-history";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

/**
 * Rendered by the live page only: the 1994–2022 archive never changes. It keeps the
 * `?historico` gate for links shared before the archive had its own page.
 */
export function PointerPoller() {
  return useHistoryMode() ? null : <Poll />;
}

function Poll() {
  usePointerPolling();
  return null;
}
