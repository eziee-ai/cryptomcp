import type { PublicClient } from "viem";
import { checkChain, type Finding } from "../kit/conform/checks";
import { parseManifest, type Manifest } from "../kit/manifest";
import type { Chains } from "../lib/chains";
import { parseEntry, parseSamples, type Entry, type Samples } from "../lib/entry";
import { iconProblems, MAX_ICON_BYTES } from "../lib/svg";
import { ENTRY_FILES } from "./pathGuard";

/**
 * Everything the validator can know about a submission without trusting it (spec §5.2).
 *
 * `files` are bytes. Nothing here executes, imports, renders or fetches anything a submission names: the only
 * network calls go through `deps`, to the RPC endpoints of chains.json and to api.github.com.
 *
 * Every check is reported, pass or fail, so a reader sees what was looked at. What could not be looked at is
 * reported as not run. Nothing is left out in silence.
 */
export const TEMPLATE_REPO = "eziee-ai/protocol-mcp-template";
export const SIZE_LIMITS: Record<(typeof ENTRY_FILES)[number], number> = { "manifest.json": 64 * 1024, "samples.json": 16 * 1024, "entry.json": 4 * 1024, "icon.svg": MAX_ICON_BYTES };

export interface ValidateInput {
  id: string;
  /** The pull request author's login, from the event GitHub sent. */
  author: string;
  /** The entry as it would be after the merge: the pull request's version of each file, or main's where it left one alone. */
  files: Map<string, Uint8Array>;
  /** `maintainers` of this entry on MAIN, or null when the entry is new. The pull request's own list never decides who may change it. */
  existingMaintainers: string[] | null;
  chains: Chains;
}

export interface RepoInfo {
  private: boolean;
  /** `owner/name` of the template the repository was created from, as GitHub records it. */
  templateRepository: string | null;
}

export interface ValidateDeps {
  clientFor(chainId: number): PublicClient;
  github: {
    getRepo(repo: string): Promise<RepoInfo | null>;
    getFile(repo: string, path: string, ref: string): Promise<{ type: string; size: number; bytes: Uint8Array } | null>;
    hasCommitsBy(repo: string, login: string): Promise<boolean>;
  };
}

const pass = (check: string, detail = ""): Finding => ({ check, status: "pass", detail });
const fail = (check: string, detail: string): Finding => ({ check, status: "fail", detail });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 400);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** What a human still owes after a green run (spec §6). Listed on every run so green never means more than it does. */
export const MANUAL: Finding[] = [
  { check: "signatures match verified source", status: "not-run", manual: true, detail: "compare each manifest abi with the contract's verified source on its explorer: same function, names and types" },
  { check: "simulated asset movements equal the decoded spend", status: "not-run", manual: true, detail: "simulate each spending action on a forked chain; what leaves the signer must equal the decoded spend" },
  { check: "address sources and proxy admin risk", status: "not-run", manual: true, detail: "each source is the protocol's own; who can upgrade each proxy is acceptable" },
  { check: "the submitter is who they say they are", status: "not-run", manual: true, detail: "the notes below are signals, not proof" },
  { check: "the live server conforms", status: "not-run", manual: true, detail: "runs on a schedule after merge, with the key the protocol gives a maintainer privately" },
];

export async function validateSubmission(input: ValidateInput, deps: ValidateDeps): Promise<Finding[]> {
  const findings: Finding[] = [];

  const missing = ENTRY_FILES.filter((name) => !input.files.has(name));
  findings.push(missing.length === 0 ? pass("the entry has its four files") : fail("the entry has its four files", `missing: ${missing.join(", ")}`));

  // Size first. A file over its limit is not decoded, not parsed, not looked at again.
  const oversized = new Set<string>();
  for (const name of ENTRY_FILES) {
    const bytes = input.files.get(name);
    if (bytes && bytes.byteLength > SIZE_LIMITS[name]) {
      oversized.add(name);
      findings.push(fail(`${name} is within its size limit`, `${bytes.byteLength} bytes; at most ${SIZE_LIMITS[name]}`));
    }
  }
  if (oversized.size > 0) return [...findings.filter((finding) => finding.status === "fail"), ...MANUAL];

  const parse = <T>(name: string, reader: (value: unknown) => T): T | undefined => {
    const bytes = input.files.get(name);
    if (!bytes) return undefined;
    try {
      const value = reader(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      findings.push(pass(`${name} parses`));
      return value;
    } catch (error) {
      findings.push(fail(`${name} parses`, message(error)));
      return undefined;
    }
  };
  const manifest: Manifest | undefined = parse("manifest.json", parseManifest);
  const entry: Entry | undefined = parse("entry.json", parseEntry);
  const samples: Samples | undefined = parse("samples.json", parseSamples);

  const icon = input.files.get("icon.svg");
  if (icon) {
    const problems = iconProblems(icon);
    findings.push(problems.length === 0 ? pass("icon.svg is an inert SVG") : fail("icon.svg is an inert SVG", problems.join("; ")));
  }

  if (manifest) {
    findings.push(manifest.id === input.id ? pass("the manifest's id is the folder's name") : fail("the manifest's id is the folder's name", `the folder is registry/${input.id}/ and the manifest says "${manifest.id}"`));

    const server = manifest.mcp ? new URL(manifest.mcp.url) : undefined;
    const serverOk = server !== undefined && server.protocol === "https:" && server.username === "" && server.password === "";
    findings.push(serverOk ? pass("the manifest names its server") : fail("the manifest names its server", "mcp.url must be present and an https: URL without credentials; the live check calls it"));
  }

  if (manifest && samples) {
    const actions = Object.keys(manifest.actions);
    const without = actions.filter((action) => !Object.hasOwn(samples, action));
    findings.push(without.length === 0 ? pass("every action has a sample") : fail("every action has a sample", `no sample intent for: ${without.join(", ")}. An action with no sample is never exercised`));
    const unknown = Object.keys(samples).filter((name) => !actions.includes(name));
    findings.push(unknown.length === 0 ? pass("every sample is for an action") : fail("every sample is for an action", `the manifest declares no action: ${unknown.join(", ")}`));
    const elsewhere = Object.entries(samples).filter(([, sample]) => !manifest.chains.includes(sample.chainId));
    findings.push(elsewhere.length === 0 ? pass("every sample is on one of the manifest's chains") : fail("every sample is on one of the manifest's chains", elsewhere.map(([name, sample]) => `${name} is on chain ${sample.chainId}`).join("; ")));
  }

  if (entry) {
    const allowed = (input.existingMaintainers ?? entry.maintainers).map((login) => login.toLowerCase());
    const may = allowed.includes(input.author.toLowerCase());
    findings.push(
      may
        ? pass("the author may change this entry")
        : fail("the author may change this entry", input.existingMaintainers === null ? "the author of a first submission must be one of the maintainers it lists" : "this entry exists, and the author is not one of its maintainers on main. The list in the pull request does not count"),
    );
  }

  if (manifest) findings.push(...(await chainFindings(manifest, input.chains, deps)));
  if (manifest && entry) findings.push(...(await sourceFindings(input, entry, deps)));

  return [...findings, ...MANUAL];
}

async function chainFindings(manifest: Manifest, chains: Chains, deps: ValidateDeps): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const chainId of manifest.chains) {
    const supported = `chain ${chainId} is one this registry supports`;
    if (!Object.hasOwn(chains, String(chainId))) {
      findings.push(fail(supported, "it is not in chains.json. Adding a chain is a separate pull request by a maintainer, because its RPC endpoint is one this repository will call"));
      continue;
    }
    findings.push(pass(supported, chains[String(chainId)]!.name));

    const answers = `[${chainId}] the RPC answers as this chain`;
    const client = deps.clientFor(chainId);
    try {
      const actual = await client.getChainId();
      if (actual !== chainId) {
        findings.push(fail(answers, `it answers as chain ${actual}`));
        continue;
      }
      findings.push(pass(answers));
    } catch {
      // Not "not run": a required check that could not be made must not read as anything but a failure. Re-run it.
      findings.push(fail(answers, "the RPC endpoint could not be reached, so nothing on this chain was checked. Push again or re-run the job"));
      continue;
    }
    findings.push(...(await checkChain(manifest, chainId, client)).map((finding) => ({ ...finding, check: `[${chainId}] ${finding.check}` })));
  }
  return findings;
}

async function sourceFindings(input: ValidateInput, entry: Entry, deps: ValidateDeps): Promise<Finding[]> {
  const findings: Finding[] = [];
  // entry.repo has passed a pattern that admits nothing but https://github.com/<owner>/<name>.
  const repo = entry.repo.slice("https://github.com/".length);
  const isPublic = "the protocol's repository is public";
  const holds = "the repository holds this manifest at the listed commit";

  let info: Awaited<ReturnType<ValidateDeps["github"]["getRepo"]>>;
  try {
    info = await deps.github.getRepo(repo);
  } catch {
    return [fail(isPublic, "GitHub could not be asked. Re-run the job")];
  }
  if (!info || info.private) return [fail(isPublic, `${repo} does not exist or is private. A listing links to source anyone can read`)];
  findings.push(pass(isPublic, repo));

  try {
    const path = `registry/${input.id}/manifest.json`;
    const file = await deps.github.getFile(repo, path, entry.commit);
    const submitted = input.files.get("manifest.json")!;
    if (!file) findings.push(fail(holds, `${path} does not exist in ${repo} at ${entry.commit}`));
    else if (file.type !== "file") findings.push(fail(holds, `${path} there is a ${file.type.slice(0, 20)}, not a file`));
    else findings.push(sameBytes(file.bytes, submitted) ? pass(holds, entry.commit) : fail(holds, `${path} in ${repo} at ${entry.commit} differs from the manifest in this pull request. They must be byte for byte the same`));
  } catch {
    findings.push(fail(holds, "GitHub could not be asked. Re-run the job"));
  }

  const fromTemplate = "the repository was created from protocol-mcp-template";
  findings.push(info.templateRepository === TEMPLATE_REPO ? pass(fromTemplate) : { check: fromTemplate, status: "note", detail: "GitHub does not record it as created from the template. That is allowed; it will not appear in the template's own list" });

  const commits = "the author has commits in the protocol's repository";
  try {
    findings.push((await deps.github.hasCommitsBy(repo, input.author)) ? pass(commits) : { check: commits, status: "note", detail: "none found. Confirm by other means that the author speaks for this protocol" });
  } catch {
    findings.push({ check: commits, status: "note", detail: "GitHub could not be asked" });
  }
  return findings;
}
