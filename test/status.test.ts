import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collect } from "../live-check/assemble";
import { assembleStatus, type CheckResult } from "../lib/status";

const result = (state: CheckResult["state"], checkedAt: string): CheckResult => ({ state, checkedAt, fromTemplate: true, summary: { pass: 1, fail: state === "failing" ? 1 : 0, notRun: 0 }, failures: [] });

describe("assembleStatus", () => {
  const day1 = "2026-09-20T00:00:00.000Z";
  const day2 = "2026-09-21T00:00:00.000Z";
  const day3 = "2026-09-22T00:00:00.000Z";

  it("keeps `since` while the state is unchanged, and moves it when the state changes", () => {
    const first = assembleStatus(null, { a: result("conformant", day1) }, day1);
    expect(first.protocols.a!.since).toBe(day1);
    const second = assembleStatus(first, { a: result("conformant", day2) }, day2);
    expect(second.protocols.a).toMatchObject({ since: day1, checkedAt: day2 });
    const third = assembleStatus(second, { a: result("failing", day3) }, day3);
    expect(third.protocols.a).toMatchObject({ state: "failing", since: day3 });
  });

  it("drops a protocol that is no longer in the registry, and is empty for an empty registry", () => {
    const first = assembleStatus(null, { a: result("conformant", day1), b: result("unchecked", day1) }, day1);
    expect(Object.keys(assembleStatus(first, { b: result("unchecked", day2) }, day2).protocols)).toEqual(["b"]);
    expect(assembleStatus(first, {}, day2)).toEqual({ generatedAt: day2, protocols: {} });
  });
});


describe("collect", () => {
  it("records a protocol whose check never finished as failing, never as anything better", () => {
    const out = mkdtempSync(join(tmpdir(), "out-"));
    writeFileSync(join(out, "a.json"), JSON.stringify(result("conformant", "2026-09-20T00:00:00.000Z")));
    const results = collect(["a", "b"], out, "2026-09-20T01:00:00.000Z");
    expect(results.a!.state).toBe("conformant");
    expect(results.b).toMatchObject({ state: "failing", failures: [{ check: "the live check completed" }] });
  });
});
