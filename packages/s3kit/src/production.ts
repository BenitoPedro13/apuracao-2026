// The production buckets (infra/lib/raw-stack.ts: apuracao26-raw-{account}; the public
// bucket apuracao26-pub, TASK-public-cdn.md). A test-signed file must never reach them
// (architecture.md §9.2, the condition of the user's approval on 2026-10-07).

export const isProductionBucket = (bucket: string | undefined): boolean =>
  bucket !== undefined && /^apuracao26-(raw|pub)(-|$)/.test(bucket);

/** Throws if a test key is configured while any of `buckets` is a production bucket. */
export function refuseTestKeyInProduction(testJwkUrl: string | undefined, buckets: Record<string, string | undefined>): void {
  if (!testJwkUrl) return;
  for (const [name, bucket] of Object.entries(buckets)) {
    if (isProductionBucket(bucket)) {
      throw new Error(`TSE_TEST_JWK_URL is set while ${name}=${bucket} is a production bucket: refusing to start`);
    }
  }
}
