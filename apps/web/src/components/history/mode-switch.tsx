"use client";

import type { ReactNode } from "react";
import { useHistoryMode } from "@/hooks/use-history";

/** `?historico` shows the 1994–2022 archive; both pages are built on the server. */
export function ModeSwitch({ live, history }: { live: ReactNode; history: ReactNode }) {
  return useHistoryMode() ? history : live;
}
