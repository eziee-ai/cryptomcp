import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".yml"));
const text = (name: string) => readFileSync(`${DIR}${name}`, "utf8");
const load = (name: string) => parse(text(name)) as { on: Record<string, unknown>; permissions?: unknown; jobs: Record<string, { environment?: unknown; permissions?: Record<string, string>; steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> }> }> };
/** A workflow without its comments, which are allowed to NAME the things the workflow must not do. */
const code = (name: string) => text(name).split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

describe("every workflow", () => {
  it.each(FILES)("%s pins each action to a full commit SHA", (name) => {
    const uses = Object.values(load(name).jobs).flatMap((job) => job.steps ?? []).map((step) => step.uses).filter((value): value is string => value !== undefined);
    expect(uses.length).toBeGreaterThan(0);
    for (const value of uses) expect(value).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });

  it.each(FILES)("%s installs without running dependency scripts, from the lockfile", (name) => {
    for (const line of code(name).split("\n").filter((entry) => /pnpm install/.test(entry))) expect(line).toMatch(/--frozen-lockfile/), expect(line).toMatch(/--ignore-scripts/);
  });

  it("only validate.yml runs on pull_request_target", () => {
    expect(FILES.filter((name) => Object.hasOwn(load(name).on, "pull_request_target"))).toEqual(["validate.yml"]);
  });
});

describe("validate.yml, which runs with this repository's token on pull requests from anyone", () => {
  const workflow = load("validate.yml");
  const source = code("validate.yml");

  it("is triggered by pull_request_target and nothing else", () => {
    expect(Object.keys(workflow.on)).toEqual(["pull_request_target"]);
  });

  it("never checks out the pull request", () => {
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
    for (const step of steps.filter((entry) => entry.uses?.startsWith("actions/checkout@"))) {
      expect(step.with?.ref).toBeUndefined();
      expect(step.with?.repository).toBeUndefined();
      expect(step.with?.["persist-credentials"]).toBe(false);
    }
    for (const forbidden of ["pull_request.head", "github.head_ref", "refs/pull", "gh pr checkout", "git fetch", "git checkout"]) expect(source).not.toContain(forbidden);
  });

  it("references no secret, and has a token that can read code and write a comment, no more", () => {
    expect(source).not.toMatch(/secrets\./);
    expect(workflow.permissions).toEqual({});
    expect(Object.values(workflow.jobs).map((job) => job.permissions)).toEqual([{ contents: "read", "pull-requests": "write" }]);
    expect(Object.values(workflow.jobs).every((job) => job.environment === undefined)).toBe(true);
  });

  it("runs only this repository's own validator, and interpolates nothing from the event into a shell", () => {
    const runs = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).map((step) => step.run).filter((value): value is string => value !== undefined);
    expect(runs).toEqual(["pnpm install --frozen-lockfile --ignore-scripts --filter .", "pnpm validate"]);
    for (const line of runs) expect(line).not.toContain("${{");
  });

  it("reports the check the ruleset requires", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["validate"]);
  });
});

describe("ci.yml, which runs the pull request's own code", () => {
  it("runs on pull_request with a read-only token and no secrets", () => {
    const workflow = load("ci.yml");
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(code("ci.yml")).not.toMatch(/secrets\./);
  });
});
