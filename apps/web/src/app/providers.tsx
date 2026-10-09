"use client";

import { Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/data/query-client";
import { usePointerPolling } from "@/hooks/use-data";
import { useHistoryMode } from "@/hooks/use-history";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {/* Reads the query string, so it sits under a Suspense (static export). */}
      <Suspense>
        <PointerPoller />
      </Suspense>
      {children}
    </QueryClientProvider>
  );
}

/** The live pointer is polled on the live page only: the 1994–2022 archive never changes. */
function PointerPoller() {
  return useHistoryMode() ? null : <Poll />;
}

function Poll() {
  usePointerPolling();
  return null;
}
