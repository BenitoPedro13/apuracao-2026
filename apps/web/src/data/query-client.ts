import { environmentManager, QueryClient } from "@tanstack/react-query";
import { DataError } from "./fetch";

// TanStack's Next.js pattern: a new client for every server render (here, the build), one
// reused singleton in the browser.

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A schema error won't fix itself by retrying; anything else (network, HTTP, a
        // hash mismatch from a bad cache) is retried with TanStack's exponential backoff.
        retry: (failures, error) => !(error instanceof DataError && error.kind === "schema") && failures < 3,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
