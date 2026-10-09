"use client";

import { useState } from "react";

/**
 * How many times `value` has changed since this component mounted (TASK-urna-number.md
 * §2.3): 0 on the first render, so nothing flashes on load. Stored from the previous
 * render (react.dev "storing information from previous renders"), not in an Effect.
 */
export function useChanged(value: string): number {
  const [prev, setPrev] = useState(value);
  const [count, setCount] = useState(0);
  if (value !== prev) {
    setPrev(value);
    setCount((c) => c + 1);
  }
  return count;
}
