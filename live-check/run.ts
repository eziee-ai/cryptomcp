/**
 * pnpm live-check <id>     one protocol's check, written to out/<id>.json
 *
 * The key comes from the environment variable MCP_KEY, which the workflow fills from the one secret that belongs to
 * this protocol. It is never an argument, so it never appears in a process list or a log.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type PublicClient } from "viem";
import { createHttpMcpCaller } from "../kit/mcp/caller";
import { loadChains } from "../lib/chains";
import { ID, loadRegistry } from "../lib/registry";
import { createGitHub } from "../validator/github";
import { checkProtocol } from "./check";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main(): Promise<void> {
  const id = process.argv[2] ?? "";
  if (!ID.test(id)) throw new Error("usage: pnpm live-check <id>");
  const entry = loadRegistry(join(ROOT, "registry")).find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`there is no registry/${id}`);

  const chains = loadChains(join(ROOT, "chains.json"));
  const github = createGitHub(process.env.GITHUB_TOKEN ?? "");
  const result = await checkProtocol(entry, process.env.MCP_KEY, {
    chains,
    clientFor: (chainId) => createPublicClient({ transport: http(chains[String(chainId)]!.rpc, { timeout: 15_000, retryCount: 2 }) }) as PublicClient,
    // https only, no redirects, 64 KB: the kit's caller refuses anything else, so the key cannot be sent in the clear or carried off.
    callerFor: (url, key) => createHttpMcpCaller({ url, apiKey: key }),
    getRepo: (repo) => github.getRepo(repo),
    now: () => new Date().toISOString(),
  });

  mkdirSync(join(ROOT, "out"), { recursive: true });
  writeFileSync(join(ROOT, "out", `${id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${id}: ${result.state} (${result.summary.pass} passed, ${result.summary.fail} failed, ${result.summary.notRun} not run)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
