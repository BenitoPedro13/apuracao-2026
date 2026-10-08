// Run standalone: node dist/main.js [port] [maxAgeSeconds]
import { fileURLToPath } from 'node:url';
import { startFakeTse } from './server.js';

const samplesDir = fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
const tse = await startFakeTse({
  samplesDir,
  port: Number(process.argv[2] ?? 8080),
  maxAgeSeconds: Number(process.argv[3] ?? 60),
});
console.log(`fake-tse serving ${samplesDir} at ${tse.url}`);
