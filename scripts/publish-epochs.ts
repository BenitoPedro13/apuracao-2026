// Add or update one round in the public `data/v1/epochs.json` (TASK-web-shell-and-data-hooks.md
// §2.3), the index the web app's round selector reads. An ops step, run when an epoch is
// seeded or promoted; readers never write it. Upserts by epoch, keeps the order (oldest
// first), validates with EpochsIndex, and touches nothing else in the bucket.
//
//   A past round, frozen at its final manifest (the pointer's, if it still names this epoch):
//     aws login && node scripts/publish-epochs.ts --epoch 1t-final --label "1º turno" [--seq 11387]
//   The round the pointer follows live (no fixed manifest yet):
//     node scripts/publish-epochs.ts --epoch 2t-1 --label "2º turno" --live --president 6258 --governor 6260
//   A re-seed under a new epoch, taking the old one's place in one write (TASK-tzdata-pin.md):
//     node scripts/publish-epochs.ts --epoch 1t-final-2 --label "1º turno" --replaces 1t-final
//   --dry-run prints the new index without writing it.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ElectionCode,
  EPOCHS_KEY,
  EpochsIndex,
  LatestPointer,
  Manifest,
  manifestKey,
  POINTER_KEY,
  type EpochEntry,
} from '@apuracao/contracts';

const { values } = parseArgs({
  options: {
    bucket: { type: 'string', default: 'apuracao26-pub-860897618882' },
    region: { type: 'string', default: 'sa-east-1' },
    epoch: { type: 'string' },
    label: { type: 'string' },
    seq: { type: 'string' },
    live: { type: 'boolean', default: false },
    president: { type: 'string' },
    governor: { type: 'string' },
    replaces: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!values.epoch || !values.label) throw new Error('--epoch and --label are required');
const epoch = values.epoch;
const s3 = new S3Client({ region: values.region });
const bucket = values.bucket;

/** The object's bytes, gunzipped when stored gzipped (views and manifests are, TASK-public-cdn.md §8.1). */
async function getBytes(key: string): Promise<Buffer | undefined> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = Buffer.from(await res.Body!.transformToByteArray());
    return raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchKey' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return undefined;
    throw e;
  }
}
const json = (b: Buffer) => JSON.parse(b.toString('utf8')) as unknown;

let entry: EpochEntry;
if (values.live) {
  entry = {
    epoch,
    label: values.label,
    elections: { president: ElectionCode.parse(values.president), governor: ElectionCode.parse(values.governor) },
    manifest: null,
  };
} else {
  const pointerBytes = await getBytes(POINTER_KEY);
  const pointer = pointerBytes ? LatestPointer.parse(json(pointerBytes)) : undefined;
  const seq = values.seq ? Number(values.seq) : pointer?.epoch === epoch ? pointer.seq : undefined;
  if (seq === undefined) throw new Error(`the pointer names ${pointer?.epoch ?? 'nothing'}: pass --seq for ${epoch}`);
  const bytes = await getBytes(manifestKey(epoch, seq));
  if (!bytes) throw new Error(`no manifest ${manifestKey(epoch, seq)}`);
  const manifest = Manifest.parse(json(bytes));
  if (manifest.epoch !== epoch || manifest.seq !== seq) throw new Error(`manifest says ${manifest.epoch}/${manifest.seq}`);
  entry = {
    epoch,
    label: values.label,
    elections: manifest.elections,
    manifest: { seq, sha: createHash('sha256').update(bytes).digest('hex') },
  };
}

const existingBytes = await getBytes(EPOCHS_KEY);
const existing = existingBytes ? EpochsIndex.parse(json(existingBytes)).epochs : [];
let epochs: EpochEntry[];
if (values.replaces) {
  // The old epoch's slot (and so its order) goes to the new one; its objects stay untouched.
  const j = existing.findIndex((e) => e.epoch === values.replaces);
  if (j < 0) throw new Error(`--replaces ${values.replaces}: not in ${EPOCHS_KEY}`);
  epochs = existing.with(j, entry).filter((e, k) => k === j || e.epoch !== epoch);
} else {
  const i = existing.findIndex((e) => e.epoch === epoch);
  epochs = i >= 0 ? existing.with(i, entry) : [...existing, entry];
}
const index = EpochsIndex.parse({ v: 1, epochs });
const body = `${JSON.stringify(index, null, 2)}\n`;

console.log(body);
if (values['dry-run']) {
  console.log('dry run: nothing written');
} else {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: EPOCHS_KEY,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    }),
  );
  console.log(`wrote s3://${bucket}/${EPOCHS_KEY} (${index.epochs.length} epochs)`);
}
