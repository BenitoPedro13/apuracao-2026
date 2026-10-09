import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UrnaNumber } from "./urna-number";

// One box per digit, as the urna's screen (TASK-urna-number.md §5 item 1).
describe("UrnaNumber", () => {
  for (const n of ["22", "131", "2222", "22222"]) {
    it(`draws ${n.length} boxes for ${n}`, () => {
      const html = renderToStaticMarkup(<UrnaNumber n={n} party="PL" />);
      expect(html.match(/<span class="inline-flex items-center/g)).toHaveLength(n.length);
      expect(html).toContain('aria-hidden="true"');
      expect(html.replace(/<[^>]+>/g, "")).toBe(n);
    });
  }
});
