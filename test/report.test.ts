import { describe, expect, it } from "vitest";
import type { Finding } from "../kit/conform/checks";
import { MARKER, renderReport } from "../validator/report";

const SHA = "a".repeat(40);

describe("renderReport", () => {
  it("starts with the marker the workflow finds its own comment by", () => {
    expect(renderReport([], { sha: SHA }).startsWith(MARKER)).toBe(true);
  });

  it("says not run, never pass, for a check that did not run, and always lists what a human still owes", () => {
    const findings: Finding[] = [
      { check: "manifest.json parses", status: "pass", detail: "" },
      { check: "the live server conforms", status: "not-run", manual: true, detail: "runs after merge" },
    ];
    const report = renderReport(findings, { id: "acme", sha: SHA });
    expect(report).toMatch(/not run.*the live server conforms/);
    expect(report).toContain("A reviewer still has to");
    expect(report).toContain("1 passed, 0 failed");
  });

  it("cannot be made to carry markdown, mentions, links or HTML by a submission's text", () => {
    const hostile = "`](https://evil.example) @everyone <img src=x onerror=alert(1)> | **bold** [x](javascript:alert(1))\n\n# heading";
    const report = renderReport([{ check: hostile, status: "fail", detail: hostile }], { id: "acme", sha: SHA });
    const body = report.split("\n").filter((line) => line.includes("evil"));
    expect(body.length).toBeGreaterThan(0);
    for (const line of body) {
      expect(line).not.toMatch(/[<>\[\]]/);
      expect(line).not.toContain("://");
      // Every piece of submitted text sits inside a code span, where @mentions and emphasis are inert.
      expect(line.split("`").length % 2).toBe(1);
      expect(line.replace(/`[^`]*`/g, "")).not.toMatch(/evil|everyone|bold|heading/);
    }
    expect(report.split("\n").some((line) => line.startsWith("# heading"))).toBe(false);
  });

  it("keeps a table row on one line and its cells intact", () => {
    const report = renderReport([{ check: "a | b", status: "fail", detail: "line one\nline two | three" }], { sha: SHA });
    const row = report.split("\n").find((line) => line.includes("line one"))!;
    expect(row).toContain("line two");
    expect(row.split("|").length).toBe(5);
  });

  it("says plainly when the pull request is not a submission", () => {
    expect(renderReport([{ check: "paths", status: "fail", detail: "touches README.md" }], { sha: SHA })).toContain("not judged as a registry submission");
  });
});
