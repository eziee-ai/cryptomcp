import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * The workflows are this repository's attack surface, so they are pinned by EXACT lists, not by looking for known
 * bad strings: which files exist, what triggers each, which actions each uses, and every `${{ }}` expression each
 * contains. A blocklist passes whatever it did not think of. Here, anything new fails until a maintainer adds it to
 * a list in this file, in a change a code owner has to read.
 */
const DIR = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
const text = (name: string) => readFileSync(`${DIR}${name}`, "utf8");
/** A workflow without its comments, which are allowed to NAME the things the workflow must not do. */
const code = (name: string) => text(name).split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  environment?: unknown;
  permissions?: Record<string, string>;
  steps?: Step[];
}
const load = (name: string) => parse(text(name)) as { on: Record<string, unknown>; permissions?: unknown; jobs: Record<string, Job> };
const steps = (name: string) => Object.values(load(name).jobs).flatMap((job) => job.steps ?? []);
const expressions = (name: string) => [...new Set([...code(name).matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map((match) => match[1]!))].sort();

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const PNPM = "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1";
const NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const UPLOAD = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const DOWNLOAD = "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";

const PINNED: Record<string, { triggers: string[]; uses: string[]; expressions: string[]; permissions: Record<string, Record<string, string>> }> = {
  "validate.yml": {
    triggers: ["pull_request_target"],
    uses: [CHECKOUT, PNPM, NODE],
    // The pull request's NUMBER, in a concurrency group. Nothing else from the event: not its title, body, branch or SHA.
    expressions: ["github.event.pull_request.number", "github.token"],
    permissions: { validate: { contents: "read", "pull-requests": "write" } },
  },
  "ci.yml": {
    triggers: ["pull_request", "push"],
    uses: [CHECKOUT, PNPM, NODE],
    expressions: ["github.ref"],
    permissions: { check: { contents: "read" } },
  },
  "live-check.yml": {
    triggers: ["schedule", "workflow_dispatch"],
    uses: [CHECKOUT, PNPM, NODE, CHECKOUT, PNPM, NODE, UPLOAD, CHECKOUT, PNPM, NODE, DOWNLOAD],
    expressions: ["fromJSON(needs.list.outputs.matrix)", "github.token", "matrix.protocol.id", "secrets.VERCEL_DEPLOY_HOOK", "secrets[format('MCP_KEY_{0}', matrix.protocol.key)]", "steps.list.outputs.empty", "steps.list.outputs.matrix"],
    permissions: { list: { contents: "read" }, check: { contents: "read" }, publish: { contents: "write" } },
  },
};

describe("the set of workflows", () => {
  it("is exactly the ones pinned here: a new workflow file is a new attack surface", () => {
    expect(readdirSync(DIR).sort()).toEqual(Object.keys(PINNED).sort());
  });

  it("has no composite action or reusable workflow of its own to hide steps in", () => {
    const github = readdirSync(fileURLToPath(new URL("../.github/", import.meta.url))).sort();
    expect(github).toEqual(["CODEOWNERS", "PULL_REQUEST_TEMPLATE.md", "dependabot.yml", "workflows"]);
  });
});

describe.each(Object.entries(PINNED))("%s", (name, pinned) => {
  const workflow = load(name);

  it("is triggered by exactly these events", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(pinned.triggers);
  });

  it("uses exactly these actions, each pinned to a full commit SHA, and none that is local or a Docker image", () => {
    const used = steps(name).map((step) => step.uses).filter((value): value is string => value !== undefined);
    expect(used).toEqual(pinned.uses);
    for (const value of used) expect(value).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    expect(JSON.stringify(workflow)).not.toMatch(/"uses":"(\.|docker:)/);
    for (const job of Object.values(workflow.jobs)) expect(job).not.toHaveProperty("uses");
  });

  it("contains exactly these expressions, anywhere in it: run, with, env, if or name", () => {
    expect(expressions(name)).toEqual(pinned.expressions);
  });

  it("puts no expression inside a shell line", () => {
    for (const step of steps(name)) if (step.run) expect(step.run).not.toContain("${{");
  });

  it("grants nothing by default, and each job exactly what is pinned", () => {
    expect([{}, { contents: "read" }]).toContainEqual(workflow.permissions);
    expect(Object.fromEntries(Object.entries(workflow.jobs).map(([job, value]) => [job, value.permissions]))).toEqual(pinned.permissions);
    expect(code(name)).not.toMatch(/write-all|read-all/);
  });

  it("runs every job on a GitHub-hosted runner, in no container, with no service beside it, in the default shell", () => {
    // Keys are pinned by ALLOWLIST. `container:` runs every pinned step inside an image of someone's choosing, with
    // the token in its environment; `services:` starts one beside it; `defaults:` swaps the shell the pinned `run:`
    // lines are handed to; a self-hosted `runs-on` is somebody's machine. A key this list does not name fails here.
    expect(Object.keys(workflow).sort()).toEqual(["concurrency", "jobs", "name", "on", "permissions"]);
    for (const [job, value] of Object.entries(workflow.jobs)) {
      expect((value as { "runs-on"?: unknown })["runs-on"], job).toBe("ubuntu-latest");
      for (const key of Object.keys(value)) expect(["if", "needs", "runs-on", "timeout-minutes", "permissions", "environment", "outputs", "strategy", "steps"], `${job}.${key}`).toContain(key);
      for (const step of value.steps ?? []) for (const key of Object.keys(step)) expect(["uses", "with", "run", "env", "id", "name"], `${job} step key ${key}`).toContain(key);
    }
  });

  it("installs from the lockfile without running dependency scripts", () => {
    for (const line of code(name).split("\n").filter((entry) => /pnpm install/.test(entry))) expect(line).toMatch(/--frozen-lockfile.*--ignore-scripts/);
  });
});

describe("validate.yml, which runs with this repository's token on pull requests from anyone", () => {
  const workflow = load("validate.yml");

  it("never checks out the pull request", () => {
    const checkouts = steps("validate.yml").filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts).toHaveLength(1);
    // Exactly this, and nothing else: no ref, no repository, no token, no path.
    expect(checkouts[0]!.with).toEqual({ "persist-credentials": false });
  });

  it("gives no step anything from the pull request: the only env is the token, and the only with is pinned", () => {
    const all = steps("validate.yml");
    expect(all.map((step) => step.env)).toEqual([undefined, undefined, undefined, undefined, { GITHUB_TOKEN: "${{ github.token }}" }]);
    expect(all.map((step) => step.with)).toEqual([{ "persist-credentials": false }, undefined, { "node-version-file": ".nvmrc" }, undefined, undefined]);
  });

  it("runs only this repository's own validator", () => {
    expect(steps("validate.yml").map((step) => step.run).filter((value) => value !== undefined)).toEqual(["pnpm install --frozen-lockfile --ignore-scripts --filter .", "pnpm validate"]);
  });

  it("references no secret and no environment, and has one job, the check the ruleset requires", () => {
    expect(code("validate.yml")).not.toMatch(/secrets/);
    expect(Object.keys(workflow.jobs)).toEqual(["validate"]);
    expect(workflow.jobs.validate!.environment).toBeUndefined();
    expect(workflow.permissions).toEqual({});
  });
});

describe("ci.yml, which runs the pull request's own code", () => {
  it("has a read-only token, no secrets, and leaves no credentials behind", () => {
    expect(load("ci.yml").permissions).toEqual({ contents: "read" });
    expect(code("ci.yml")).not.toMatch(/secrets/);
    for (const step of steps("ci.yml").filter((entry) => entry.uses?.startsWith("actions/checkout@"))) expect(step.with).toEqual({ "persist-credentials": false });
  });
});

describe("live-check.yml, which holds every protocol's key", () => {
  const workflow = load("live-check.yml");

  it("reads a secret only in a job bound to the live-check environment", () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const readsSecret = (job.steps ?? []).some((step) => JSON.stringify(step).includes("secrets"));
      expect(job.environment, name).toBe(readsSecret ? "live-check" : job.environment);
      if (readsSecret) expect(job.environment, name).toBe("live-check");
    }
  });

  it("gives each matrix job one key, its own, and never the whole set", () => {
    expect(steps("live-check.yml").flatMap((step) => Object.entries(step.env ?? {}))).toContainEqual(["MCP_KEY", "${{ secrets[format('MCP_KEY_{0}', matrix.protocol.key)] }}"]);
    expect(code("live-check.yml")).not.toMatch(/toJSON\(\s*secrets|secrets\s*\)/);
  });

  it("leaves no credentials in any checkout, and hands the write token to the push step alone", () => {
    for (const step of steps("live-check.yml").filter((entry) => entry.uses?.startsWith("actions/checkout@"))) expect(step.with).toEqual({ "persist-credentials": false });
    const withToken = steps("live-check.yml").filter((step) => Object.values(step.env ?? {}).includes("${{ github.token }}"));
    expect(withToken.map((step) => Object.keys(step.env!))).toEqual([["PROTOCOL_ID", "MCP_KEY", "GITHUB_TOKEN"], ["PUSH_TOKEN"]]);
  });
});
