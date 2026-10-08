// node dist/main.js [--capture <dir>] [--speed 20] [--port 8080] [--max-age 60]
//                   [--start 2026-10-04T17:00:00-03:00] [--max-gap-min 10] [--faults '<json>'] [--static]
// Without --capture it serves docs/research/samples. --static serves every file final (v0).
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startFakeTse } from './server.js';
import { REPLAY_START_1T } from './reveal.js';

const { values } = parseArgs({
  options: {
    capture: { type: 'string' },
    speed: { type: 'string', default: '20' },
    port: { type: 'string', default: '8080' },
    host: { type: 'string', default: '127.0.0.1' },
    'max-age': { type: 'string', default: '60' },
    start: { type: 'string' },
    'max-gap-min': { type: 'string', default: '10' },
    faults: { type: 'string' },
    static: { type: 'boolean', default: false },
  },
});

const samplesDir = values.capture ?? fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
const tse = await startFakeTse({
  samplesDir,
  port: Number(values.port),
  host: values.host,
  maxAgeSeconds: Number(values['max-age']),
  reveal: values.static
    ? undefined
    : { origin: values.start ? Date.parse(values.start) : REPLAY_START_1T, speed: Number(values.speed), maxGapMs: Number(values['max-gap-min']) * 60_000 },
  faults: values.faults ? JSON.parse(values.faults) : undefined,
});
console.log(JSON.stringify({
  msg: 'fake-tse started',
  url: tse.url,
  capture: samplesDir,
  files: tse.plan?.entries.size,
  testKid: tse.signer?.jwk.kid,
  endsAt: tse.replay ? new Date(tse.replay.endsAt).toISOString() : undefined,
}));
const shutdown = () => void tse.close().then(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
