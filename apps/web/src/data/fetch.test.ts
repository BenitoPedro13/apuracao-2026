import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Manifest, manifestKey, ResultView, viewKey } from "@apuracao/contracts";
import { pointer, readReal, viewSha } from "../../test/real";
import { DataError, fetchVerified } from "./fetch";

// Real HTTP against the real published files (no mocked fetch). `/tampered/…` serves a
// view's bytes with one character changed, as a bad cache or a mixed-up upload would.

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(req.url ?? "/").replace(/^\/+/, "");
    const tampered = path.startsWith("tampered/");
    try {
      let body = readReal(tampered ? path.slice("tampered/".length) : path);
      if (tampered) body = Buffer.from(body.toString("utf8").replace("53879538", "53879539"));
      res.writeHead(200, { "content-type": "application/json" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("fetchVerified", () => {
  it("accepts the real manifest and national view, whose bytes hash to their names", async () => {
    const m = await fetchVerified(`${base}/${manifestKey(pointer.epoch, pointer.seq)}`, pointer.manifest, Manifest);
    expect(m.seq).toBe(pointer.seq);
    const sha = viewSha("result/president/br");
    const br = await fetchVerified(`${base}/${viewKey(sha)}`, sha, ResultView);
    expect(br.candidates.find((c) => c.n === "13")).toMatchObject({ votes: 53879538, pct: { raw: "45,16" } });
  });

  it("rejects a view whose bytes don't hash to its name, before parsing", async () => {
    const sha = viewSha("result/president/br");
    const err = await fetchVerified(`${base}/tampered/${viewKey(sha)}`, sha, ResultView).catch((e) => e);
    expect(err).toBeInstanceOf(DataError);
    expect(err.kind).toBe("hash");
  });

  it("reports a missing object as an HTTP error, never as empty data", async () => {
    const err = await fetchVerified(`${base}/${viewKey("0".repeat(64))}`, "0".repeat(64), ResultView).catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 404 });
  });
});
