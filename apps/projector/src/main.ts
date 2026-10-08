import { parseArgs } from 'node:util';
import { S3Client } from '@aws-sdk/client-s3';
import { loadConfig, type ProjectorConfig } from './config.js';
import { createProjector } from './projector.js';
import { DirPublisher, S3Publisher, type Publisher } from './publisher.js';

// projector [run]                 live: tail the raw log, publish (TASK §2.3)
// projector rebuild --source s3 --epoch <e> [--out s3://bucket | dir] [--promote]
//                                 fold the whole log once, publish the final state, print timings

function s3Client(c: ProjectorConfig): S3Client {
  return new S3Client({ region: c.AWS_REGION, ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT, forcePathStyle: true } : {}) });
}

function publisherFor(out: string | undefined, c: ProjectorConfig, s3: S3Client): Publisher {
  const target = out ?? (c.PUB_BUCKET ? `s3://${c.PUB_BUCKET}` : c.PUB_DIR);
  if (!target) throw new Error('set PUB_BUCKET or PUB_DIR (or --out)');
  return target.startsWith('s3://') ? new S3Publisher(s3, target.slice(5)) : new DirPublisher(target);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { source: { type: 'string' }, epoch: { type: 'string' }, out: { type: 'string' }, promote: { type: 'boolean' } },
  });
  const command = positionals[0] ?? 'run';
  const config = loadConfig({
    ...process.env,
    ...(values.epoch ? { EPOCH: values.epoch } : {}),
    ...(values.promote ? { PROMOTE: 'true' } : {}),
  });
  const s3 = s3Client(config);
  const publisher = publisherFor(values.out, config, s3);

  if (command === 'rebuild') {
    if ((values.source ?? 's3') !== 's3') throw new Error('only --source s3 exists until TASK-kafka-log.md');
    const p = createProjector({ config, s3, publisher });
    const t0 = performance.now();
    const res = await p.rebuild();
    const wallMs = Math.round(performance.now() - t0);
    const timings = Object.fromEntries(Object.entries(p.timings).map(([k, v]) => [k, Math.round(v)]));
    console.log(JSON.stringify({ msg: 'rebuild done', epoch: config.EPOCH, target: publisher.target, wallMs, timings, ...res, stats: p.stats, blobGets: p.blobs.gets }, null, 2));
    return;
  }
  if (command !== 'run') throw new Error(`unknown command ${command}`);

  const p = createProjector({ config, s3, publisher });
  await p.start();
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ msg: 'shutdown', signal }));
    await p.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ msg: 'fatal', error: (err as Error).stack ?? String(err) }));
  process.exit(1);
});
