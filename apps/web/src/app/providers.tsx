"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/data/query-client";
import { usePointerPolling } from "@/hooks/use-data";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <PointerPoller />
      {children}
    </QueryClientProvider>
  );
}

function PointerPoller() {
  usePointerPolling();
  return null;
}
