import type { z } from "zod";

// Fetching the published objects. Every immutable object is checked against the hash it is
// named by before it's parsed: a corrupted or mixed-up object is an error, never shown
// (TASK-web-shell-and-data-hooks.md §2.2).

export type DataErrorKind = "network" | "http" | "hash" | "schema";

export class DataError extends Error {
  constructor(
    readonly kind: DataErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataError";
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Fetched {
  bytes: ArrayBuffer;
  /** The response's `Date` header in ms, when readable (same origin); null cross-origin. */
  serverDate: number | null;
}

export async function fetchBytes(url: string, signal?: AbortSignal, cache?: RequestCache): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new DataError("network", url, `falha de rede: ${(e as Error).message}`);
  }
  if (!res.ok) throw new DataError("http", url, `HTTP ${res.status}`, res.status);
  const date = res.headers.get("date");
  const serverDate = date ? Date.parse(date) : NaN;
  return { bytes: await res.arrayBuffer(), serverDate: Number.isNaN(serverDate) ? null : serverDate };
}

export function parseJson<S extends z.ZodType>(url: string, bytes: ArrayBuffer, schema: S): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DataError("schema", url, "JSON inválido");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new DataError("schema", url, `formato inesperado: ${parsed.error.message}`);
  return parsed.data;
}

/** Fetches an immutable object and accepts it only if its bytes hash to `sha`. */
export async function fetchVerified<S extends z.ZodType>(
  url: string,
  sha: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const { bytes } = await fetchBytes(url, signal);
  const actual = await sha256Hex(bytes);
  if (actual !== sha) throw new DataError("hash", url, `conteúdo não confere com o hash (${actual.slice(0, 12)}…)`);
  return parseJson(url, bytes, schema);
}
