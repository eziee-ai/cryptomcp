/**
 * The entry point of `.github/workflows/validate.yml`.
 *
 * It runs from `main`, on `pull_request_target`. The pull request is never checked out. Its changed files are read
 * through the GitHub API at the head commit's SHA, as bytes, under names this program chose (`pathGuard`). Nothing
 * from the pull request is installed, imported, rendered or executed here, and that is the whole of why this
 * workflow is allowed to exist. Keep it so.
 */
import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type PublicClient } from "viem";
import { summarize, type Finding } from "../kit/conform/checks";
import { loadChains, type Chains } from "../lib/chains";
import { parseEntry } from "../lib/entry";
import { parseReserved, type ResolveTxt } from "../lib/identity";
import { createGitHub, type GitHub } from "./github";
import { ENTRY_FILES, guardPaths } from "./pathGuard";
import { MARKER, renderReport } from "./report";
import { SIZE_LIMITS, validateSubmission } from "./validate";

export interface PullRequestEvent {
  repository: { full_name: string; default_branch: string };
  pull_request: { number: number; author_association: string; user: { login: string }; head: { sha: string }; base: { ref: string } };
}

export interface RunDeps {
  github: GitHub;
  chains: Chains;
  reserved: string[];
  resolveTxt: ResolveTxt;
  clientFor(chainId: number): PublicClient;
}

/** Judge one pull request. Returns the findings and the report it posted; `ok` is what the required check reports. */
export async function run(event: PullRequestEvent, deps: RunDeps): Promise<{ ok: boolean; findings: Finding[]; report: string }> {
  const repo = event.repository.full_name;
  const { number, head, base, user, author_association: association } = event.pull_request;
  const finish = async (findings: Finding[], id?: string, kind: "submission" | "maintainer-change" = "submission") => {
    const report = renderReport(findings, { id, sha: head.sha, kind });
    await deps.github.upsertComment(repo, number, MARKER, report);
    // Strict: a check that could have run and did not is not a pass. Checks only a human can make do not count.
    return { ok: summarize(findings, { strict: true }).ok, findings, report };
  };

  // Only `main` is protected, and only `main` is what the site and the app read. A pull request into any other
  // branch would be judged against that branch's copy of an entry, which nobody reviewed.
  if (base.ref !== event.repository.default_branch) return finish([{ check: "the pull request is into the default branch", status: "fail", detail: "submissions are judged against the default branch and merged into it, and nowhere else" }]);

  const changed = await deps.github.listPrFiles(repo, number);
  // Asked AFTER the list, so the two describe the same moment. If the pull request was pushed to since the event
  // that started this run, the list above belongs to a commit this run is not judging: stop. The push started a
  // run of its own, and that one will judge it.
  const now = await deps.github.getPr(repo, number);
  if (now.headSha !== head.sha) return finish([{ check: "the pull request held still while it was judged", status: "fail", detail: "it was pushed to after this run began. The run for the new commit judges it" }]);
  // GitHub counts the pull request's files itself. If the list is shorter than the count, something is not being
  // shown to the path guard, and a guard that has not seen every path has not guarded anything.
  if (changed.length !== now.changedFiles) return finish([{ check: "every changed file was listed", status: "fail", detail: `GitHub counts ${now.changedFiles} changed files and listed ${changed.length}. Push again; if it persists the pull request is too large to judge` }]);

  const guard = guardPaths(changed, { login: user.login, association });
  if (guard.kind === "refused") return finish(guard.problems.map((detail) => ({ check: "the pull request touches one registry entry and nothing else", status: "fail" as const, detail })));
  if (guard.kind === "maintainer-change") return finish([{ check: "registry submission", status: "note", detail: "this is a maintainer's change, not a submission. The validator has nothing to judge; code owners review it" }], undefined, "maintainer-change");

  // `main` as it is NOW, not as it was when the pull request was last pushed. The event's base.sha goes stale the
  // moment anything else merges: judged against it, a maintainer removed from an entry yesterday would still pass.
  const mainSha = await deps.github.getBranchHead(repo, base.ref);

  // The entry as it would be after the merge: the pull request's version of each file, or main's where it left one alone.
  const files = new Map<string, Uint8Array>();
  const findings: Finding[] = [];
  for (const name of ENTRY_FILES) {
    const path = `registry/${guard.id}/${name}`;
    // A file the pull request says it adds or modifies MUST be read from the pull request. Falling back to main's
    // copy when that read comes back empty would judge main's file and pass the pull request's unseen one.
    const inPullRequest = changed.some((entry) => entry.filename === path);
    const file = await deps.github.getFile(repo, path, inPullRequest ? head.sha : mainSha);
    if (!file) {
      if (inPullRequest) findings.push({ check: `${name} can be read from the pull request`, status: "fail", detail: "GitHub lists it as changed and it could not be read at the head commit. Push again" });
      continue;
    }
    // Refused before a byte of it is decoded: anything that is not a plain file, and anything over its limit.
    if (file.type !== "file") findings.push({ check: `${name} is a plain file`, status: "fail", detail: `it is a ${file.type.slice(0, 20)}` });
    else if (file.size > SIZE_LIMITS[name]) findings.push({ check: `${name} is within its size limit`, status: "fail", detail: `${file.size} bytes; at most ${SIZE_LIMITS[name]}` });
    else files.set(name, file.bytes);
  }
  if (findings.length > 0) return finish(findings, guard.id);

  // Who may change an existing entry is read from MAIN. The pull request cannot vote itself in.
  let existingMaintainers: string[] | null = null;
  const current = await deps.github.getFile(repo, `registry/${guard.id}/entry.json`, mainSha);
  if (current) {
    try {
      existingMaintainers = parseEntry(JSON.parse(new TextDecoder().decode(current.bytes))).maintainers;
    } catch {
      // An entry on main that no longer parses has no maintainers anyone can be checked against. Only a maintainer fixes that.
      existingMaintainers = [];
    }
  }

  return finish(await validateSubmission({ id: guard.id, author: user.login, files, existingMaintainers, chains: deps.chains, reserved: deps.reserved }, { clientFor: deps.clientFor, github: deps.github, resolveTxt: deps.resolveTxt }), guard.id);
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !eventPath) throw new Error("GITHUB_TOKEN and GITHUB_EVENT_PATH are required");
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as Partial<PullRequestEvent>;
  if (!event.pull_request || !event.repository) throw new Error("this is not a pull request event");

  // chains.json comes from this checkout, which is main. The RPC endpoints in it are the only ones ever called.
  const chains = loadChains(new URL("../chains.json", import.meta.url));
  const clientFor = (chainId: number) => createPublicClient({ transport: http(chains[String(chainId)]!.rpc, { timeout: 15_000, retryCount: 2 }) }) as PublicClient;

  const reserved = parseReserved(JSON.parse(readFileSync(new URL("../reserved.json", import.meta.url), "utf8")));
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  const resolveTxt: ResolveTxt = async (name) => (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""));

  const { ok, findings } = await run(event as PullRequestEvent, { github: createGitHub(token), chains, clientFor, reserved, resolveTxt });
  const counts = summarize(findings, { strict: true });
  console.log(`${counts.pass} passed, ${counts.fail} failed, ${counts.notRun} not run, ${counts.note} note(s)`);
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // The full error is for the job log. It never reaches the pull request.
    console.error(error);
    process.exitCode = 1;
  });
}
