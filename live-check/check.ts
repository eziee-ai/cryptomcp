import { getAddress, type PublicClient } from "viem";
import { checkChain, checkServer, summarize, type Finding } from "../kit/conform/checks";
import type { McpCaller } from "../kit/mcp/caller";
import { clean } from "../kit/text";
import type { Chains } from "../lib/chains";
import type { RegistryEntry } from "../lib/registry";
import type { CheckResult } from "../lib/status";
import { TEMPLATE_REPO, type RepoInfo } from "../validator/validate";

/**
 * One protocol's live check (spec section 7): eziee's own conformance, run against the server the merged manifest
 * names, with the key that protocol gave a maintainer.
 *
 * It runs from `main` only, on a schedule. Everything it reads was reviewed and merged: the manifest, the samples,
 * the URL the key is sent to. The key is sent to that URL and nowhere else; the kit's caller is https only, follows
 * no redirect, and stops reading at 64 KB.
 */
export interface CheckDeps {
  chains: Chains;
  clientFor(chainId: number): PublicClient;
  callerFor(url: string, key: string): McpCaller;
  getRepo(repo: string): Promise<RepoInfo | null>;
  now(): string;
}

// The account sample intents are built for. It holds nothing and signs nothing; builds are decoded, never sent.
const ACCOUNT = getAddress("0x0000000000000000000000000000000000001001");

export async function checkProtocol(entry: RegistryEntry, key: string | undefined, deps: CheckDeps): Promise<CheckResult> {
  const checkedAt = deps.now();

  let fromTemplate: boolean | null = null;
  try {
    const repo = await deps.getRepo(entry.entry.repo.slice("https://github.com/".length));
    fromTemplate = repo ? repo.templateRepository === TEMPLATE_REPO : null;
  } catch {
    fromTemplate = null;
  }

  // No key is not a failure. It is the state between a merge and the protocol handing its key over, and the site
  // says "Listed" for it. Nothing is asked of the server: an unauthenticated probe would tell us nothing true.
  if (!key) return { state: "unchecked", checkedAt, fromTemplate, summary: { pass: 0, fail: 0, notRun: 0 }, failures: [] };

  const findings: Finding[] = [];
  const url = entry.manifest.mcp?.url;
  if (!url) findings.push({ check: "the manifest names its server", status: "fail", detail: "no mcp.url" });
  else {
    try {
      findings.push(...(await checkServer(entry.manifest, deps.callerFor(url, key), { samples: entry.samples, account: ACCOUNT, nowMs: Date.parse(checkedAt) })));
    } catch (error) {
      findings.push({ check: "server lists its tools", status: "fail", detail: error instanceof Error ? error.message : "unknown error" });
    }
  }

  for (const chainId of entry.manifest.chains) {
    if (!Object.hasOwn(deps.chains, String(chainId))) {
      findings.push({ check: `chain ${chainId} is one this registry supports`, status: "fail", detail: "it is no longer in chains.json" });
      continue;
    }
    try {
      const client = deps.clientFor(chainId);
      const actual = await client.getChainId();
      if (actual !== chainId) findings.push({ check: `chain ${chainId}: the RPC answers as this chain`, status: "fail", detail: `it answers as chain ${actual}` });
      else findings.push(...(await checkChain(entry.manifest, chainId, client)).map((finding) => ({ ...finding, check: `chain ${chainId}: ${finding.check}` })));
    } catch {
      // Our RPC being down says nothing about the protocol. Reported as not run, which keeps it from reading as conformant.
      findings.push({ check: `chain ${chainId}: the RPC answers as this chain`, status: "not-run", detail: "the RPC endpoint could not be reached" });
    }
  }

  const summary = summarize(findings, { strict: true });
  const failures = findings.filter((finding) => finding.status === "fail" || finding.status === "not-run").slice(0, 50).map((finding) => ({ check: clean(finding.check, 120), detail: clean(finding.detail, 200) }));
  return { state: summary.ok ? "conformant" : "failing", checkedAt, fromTemplate, summary: { pass: summary.pass, fail: summary.fail, notRun: summary.notRun }, failures };
}
