// A static server for the export (`out/`) or a published-data directory (PUB_DIR, e.g.
// `.replay/real/pub`), with the bucket's CORS. Text is sent gzipped, as the deploy uploads
// it (`Content-Encoding: gzip`; S3 doesn't compress). Local runs and e2e only.
//   node e2e/serve.ts <dir> <port>
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const [dir = "out", port = "3100"] = process.argv.slice(2);
const root = resolve(dir);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  let file = join(root, path);
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
  } catch {
    // The bucket answers a missing key with 403 (no ListBucket), so readers see that here too.
    return void res.writeHead(403, { "access-control-allow-origin": "*" }).end();
  }
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const gzip = /text|javascript|json/.test(type) && /\bgzip\b/.test(String(req.headers["accept-encoding"]));
  const body = gzip ? gzipSync(readFileSync(file), { level: 9 }) : readFileSync(file);
  res.writeHead(200, {
    "content-type": type,
    ...(gzip ? { "content-encoding": "gzip" } : {}),
    "access-control-allow-origin": "*",
    "cache-control": file.endsWith("latest.json") ? "max-age=5" : "max-age=60",
  });
  res.end(body);
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
