import { describe, expect, it } from "vitest";
import type { GitHub, RemoteFile } from "../validator/github";
import { run, type PullRequestEvent } from "../validator/main";
import type { ChangedFile } from "../validator/pathGuard";
import { fakeClient, fixtureFiles, FIXTURE_CHAINS, json, parsed } from "./helpers";

const HEAD = "b".repeat(40);
const BASE = "a".repeat(40);
const event = (login = "alice", association = "NONE", changedFiles?: number): PullRequestEvent => ({ repository: { full_name: "eziee-ai/cryptomcp" }, pull_request: { number: 7, changed_files: changedFiles ?? -1, author_association: association, user: { login }, head: { sha: HEAD }, base: { sha: BASE } } });

/** A GitHub that holds a pull request's files at HEAD, main's at BASE, and the protocol's own repository. */
function fakeGitHub(options: { changed: ChangedFile[]; head?: Record<string, RemoteFile>; base?: Record<string, RemoteFile> }) {
  const posted: string[] = [];
  const reads: Array<[string, string, string]> = [];
  const manifest = fixtureFiles().get("manifest.json")!;
  const github: GitHub = {
    listPrFiles: async () => options.changed,
    getFile: async (repo, path, ref) => {
      reads.push([repo, path, ref]);
      if (repo === "eziee-ai/protocol-mcp-template") return { type: "file", size: manifest.byteLength, bytes: manifest };
      return (ref === HEAD ? options.head?.[path] : options.base?.[path]) ?? null;
    },
    getRepo: async () => ({ private: false, templateRepository: "eziee-ai/protocol-mcp-template" }),
    hasCommitsBy: async () => true,
    upsertComment: async (_repo, _pr, _marker, body) => void posted.push(body),
  };
  return { github, posted, reads };
}

const asRemote = (files: Map<string, Uint8Array>): Record<string, RemoteFile> => Object.fromEntries([...files].map(([name, bytes]) => [`registry/yourprotocol/${name}`, { type: "file", size: bytes.byteLength, bytes }]));
const added = (files: Record<string, RemoteFile>): ChangedFile[] => Object.keys(files).map((filename) => ({ filename, status: "added" }));
const deps = (github: GitHub) => ({ github, chains: FIXTURE_CHAINS, clientFor: () => fakeClient() });
/** Runs with the event's file count set to what the fake GitHub lists, as the real event's would be. */
async function judge(github: GitHub, login?: string, association?: string) {
  const count = (await github.listPrFiles("eziee-ai/cryptomcp", 7)).length;
  return run(event(login, association, count), deps(github));
}

describe("run", () => {
  it("passes a good first submission and posts one report", async () => {
    const head = asRemote(fixtureFiles());
    const { github, posted } = fakeGitHub({ changed: added(head), head });
    const result = await judge(github);
    expect(result.findings.filter((finding) => finding.status === "fail")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("The automatic checks pass");
  });

  it("reads the pull request's files at the head SHA, and only under the names it chose itself", async () => {
    const head = asRemote(fixtureFiles());
    const { github, reads } = fakeGitHub({ changed: added(head), head });
    await judge(github);
    const own = reads.filter(([repo]) => repo === "eziee-ai/cryptomcp");
    expect(own.every(([, path, ref]) => /^registry\/yourprotocol\/(manifest\.json|samples\.json|icon\.svg|entry\.json)$/.test(path) && (ref === HEAD || ref === BASE))).toBe(true);
  });

  it("refuses an outsider's change to a workflow, reads none of it, and fails the check", async () => {
    const { github, posted, reads } = fakeGitHub({ changed: [{ filename: ".github/workflows/validate.yml", status: "modified" }] });
    const result = await judge(github, "mallory");
    expect(result.ok).toBe(false);
    expect(reads).toEqual([]);
    expect(posted[0]).toContain("not judged as a registry submission");
  });

  it("passes a maintainer's change to the code without judging it", async () => {
    const { github } = fakeGitHub({ changed: [{ filename: "validator/main.ts", status: "modified" }] });
    expect((await judge(github, "hskang9", "OWNER")).ok).toBe(true);
  });

  it("fails a symlink and an oversized file before decoding either", async () => {
    const head = asRemote(fixtureFiles());
    head["registry/yourprotocol/icon.svg"] = { type: "symlink", size: 20, bytes: new Uint8Array() };
    head["registry/yourprotocol/manifest.json"] = { type: "file", size: 70_000, bytes: new Uint8Array() };
    const { github } = fakeGitHub({ changed: added(head), head });
    const result = await judge(github);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.check)).toEqual(["manifest.json is within its size limit", "icon.svg is a plain file"]);
  });

  it("takes an update's untouched files from main, and its maintainers from main too", async () => {
    const base = asRemote(fixtureFiles());
    // mallory changes only entry.json, adding herself. main's list has alice alone.
    const files = fixtureFiles();
    const entry = parsed(files, "entry.json");
    entry.maintainers.push("mallory");
    const head = { "registry/yourprotocol/entry.json": { type: "file", size: 300, bytes: json(entry) } };
    const { github } = fakeGitHub({ changed: [{ filename: "registry/yourprotocol/entry.json", status: "modified" }], head, base });

    const byMallory = await judge(github, "mallory");
    expect(byMallory.ok).toBe(false);
    expect(byMallory.findings.find((finding) => finding.check === "the author may change this entry")).toMatchObject({ status: "fail" });
    // The rest of the entry was read from main and still checks out.
    expect(byMallory.findings.find((finding) => finding.check === "manifest.json parses")).toMatchObject({ status: "pass" });

    expect((await judge(github, "alice")).ok).toBe(true);
  });

  it("fails when GitHub counts more changed files than it listed, without reading any", async () => {
    const head = asRemote(fixtureFiles());
    const { github, reads } = fakeGitHub({ changed: added(head), head });
    const result = await run(event("alice", "NONE", 5), deps(github));
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.check)).toEqual(["every changed file was listed"]);
    expect(reads).toEqual([]);
  });

  it("never judges main's copy of a file the pull request changed: an unreadable one fails", async () => {
    const base = asRemote(fixtureFiles());
    // The pull request modifies manifest.json, and the read at its head comes back empty. main has a good copy.
    const { github } = fakeGitHub({ changed: [{ filename: "registry/yourprotocol/manifest.json", status: "modified" }], head: {}, base });
    const result = await judge(github, "alice");
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.check)).toContain("manifest.json can be read from the pull request");
  });
});
