import { S3Client } from '@aws-sdk/client-s3';
import { loadConfig } from './config.js';
import { createFetcher } from './fetch.js';
import { createRecorder } from './recorder.js';

const config = loadConfig();
const s3 = new S3Client({
  region: config.AWS_REGION,
  ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true } : {}),
});
const fetcher = createFetcher({ baseUrl: config.TSE_BASE_URL, userAgent: config.USER_AGENT });
const recorder = createRecorder({ config, s3, fetcher });

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ msg: 'shutting down', signal }));
  await recorder.stop();
  await fetcher.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await recorder.start();
