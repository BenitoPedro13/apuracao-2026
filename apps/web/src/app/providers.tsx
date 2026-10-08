"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/data/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
