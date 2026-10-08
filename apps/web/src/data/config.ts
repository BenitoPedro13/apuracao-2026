// Where the published data lives (architecture.md §6.2). Inlined at build time. Plan B
// (TASK-public-cdn.md §8) serves it straight from the bucket; CloudFront later changes only
// this URL. Locally, `pnpm --filter @apuracao/web serve-data` stands in for the bucket.
const PLAN_B = "https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com";

export const DATA_BASE_URL = (process.env.NEXT_PUBLIC_DATA_BASE_URL || PLAN_B).replace(/\/+$/, "");

export const dataUrl = (key: string) => `${DATA_BASE_URL}/${key}`;
