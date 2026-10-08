import { queryOptions, type QueryClient } from "@tanstack/react-query";
import {
  EPOCHS_KEY,
  EpochsIndex,
  LatestPointer,
  Manifest,
  manifestKey,
  POINTER_KEY,
  viewKey,
} from "@apuracao/contracts";
import type { z } from "zod";
import { dataUrl } from "./config";
import { DataError, fetchBytes, fetchVerified, parseJson } from "./fetch";

// One queryOptions factory per endpoint (key + fn together), architecture.md §6.4.

/** Until the first pointer arrives with its own `pollSeconds`. */
export const DEFAULT_POLL_SECONDS = 20;
/** Clients wait 0–3 s before fetching a new manifest, so viewers don't all arrive at once (§6.1 item 4). */
export const MANIFEST_JITTER_MS = 3000;

export interface PointerSnapshot {
  pointer: LatestPointer;
  /** The server's clock when this pointer was fetched (the `Date` header), else the local clock. */
  serverNow: number;
  /** The local clock at the same moment: ages are serverNow + (now − localNow) − t. */
  localNow: number;
}

/** Forward-only within an epoch: an older copy (a stale cache) never replaces a newer one. */
export function newerPointer(prev: PointerSnapshot | undefined, next: PointerSnapshot): PointerSnapshot {
  if (!prev || prev.pointer.epoch !== next.pointer.epoch) return next;
  if (next.pointer.seq < prev.pointer.seq) return prev;
  if (next.pointer.seq === prev.pointer.seq && next.pointer.refreshedAt < prev.pointer.refreshedAt) return prev;
  return next;
}

export const pointerQuery = () =>
  queryOptions({
    queryKey: ["pointer"] as const,
    queryFn: async ({ signal, client }): Promise<PointerSnapshot> => {
      const url = dataUrl(POINTER_KEY);
      const localNow = Date.now();
      const { bytes, serverDate } = await fetchBytes(url, signal);
      const next = { pointer: parseJson(url, bytes, LatestPointer), serverNow: serverDate ?? localNow, localNow };
      return newerPointer(client.getQueryData<PointerSnapshot>(["pointer"]), next);
    },
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.pointer.pollSeconds ?? DEFAULT_POLL_SECONDS) * 1000,
    // Paused while the tab is hidden; refetched as soon as it's visible again.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

/** null: no index published yet (a missing key is a 403 on the bucket, 404 elsewhere). */
export const epochsQuery = () =>
  queryOptions({
    queryKey: ["epochs"] as const,
    queryFn: async ({ signal }): Promise<EpochsIndex | null> => {
      const url = dataUrl(EPOCHS_KEY);
      try {
        const { bytes } = await fetchBytes(url, signal);
        return parseJson(url, bytes, EpochsIndex);
      } catch (e) {
        if (e instanceof DataError && (e.status === 403 || e.status === 404)) return null;
        throw e;
      }
    },
    staleTime: 300_000, // the object's own max-age
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

export interface ManifestRef {
  epoch: string;
  seq: number;
  sha: string;
}

const hasManifestOf = (client: QueryClient, epoch: string) =>
  client.getQueriesData<Manifest>({ queryKey: ["manifest", epoch] }).some(([, data]) => data !== undefined);

export const manifestQuery = (ref: ManifestRef) =>
  queryOptions({
    queryKey: ["manifest", ref.epoch, ref.seq, ref.sha] as const,
    queryFn: async ({ signal, client }) => {
      // The first manifest loads at once; a newer seq of the same epoch waits 0–3 s.
      if (hasManifestOf(client, ref.epoch)) await sleep(Math.random() * MANIFEST_JITTER_MS, signal);
      return fetchVerified(dataUrl(manifestKey(ref.epoch, ref.seq)), ref.sha, Manifest, signal);
    },
    staleTime: Infinity,
  });

/**
 * A content-addressed view: immutable, so fetched once per hash. The name is in the key so
 * a placeholder carries over only the same view across seqs, never another UF's data.
 */
export const viewQuery = <S extends z.ZodType>(name: string, sha: string, schema: S) =>
  queryOptions({
    queryKey: ["view", name, sha] as const,
    queryFn: ({ signal }): Promise<z.infer<S>> => fetchVerified(dataUrl(viewKey(sha)), sha, schema, signal),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}
