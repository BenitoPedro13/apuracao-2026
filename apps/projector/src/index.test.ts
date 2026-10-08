import { expect, test } from "vitest";
import { packageName } from "./index.js";

test("workspace is wired", () => {
  expect(packageName).toBe("@apuracao/projector");
});
