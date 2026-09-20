import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, type RegistryEntry } from "../../../lib/registry";
import { loadChains, type Chains } from "../../../lib/chains";
import { parseStatus, EMPTY_STATUS, type Status, type ProtocolStatus } from "../../../lib/status";

/*
 * NOTE ON RELATIVE PATHS: the task brief that specified this file said to import `loadRegistry` from
 * "../../lib/registry" and `chains.json` from "../chains.json". Taken literally from this file's own location
 * (site/src/lib/data.ts) those resolve to site/lib/registry and site/chains.json, which do not exist — the
 * repository's `lib/` and `chains.json` live at the repo root, three levels up from here, not two. This file uses
 * the import specifiers that actually resolve ("../../../lib/...").
 *
 * NOTE ON `process.cwd()` vs `import.meta.url`: this file used to derive the repo root from `import.meta.url`,
 * which is wrong once Astro bundles it for prerendering — the bundled chunk lives under
 * `dist/.prerender/chunks/`, so `import.meta.url` there points at the *build output*, not the source tree, and
 * "../.." from it lands inside `dist/`. `process.cwd()` is reliable instead, because `astro build`, `astro dev`
 * and this package's `vitest` are always run with site/ as the working directory (`pnpm --filter site <script>`,
 * or any script run from inside site/); the root `package.json` documents the same assumption for its own test.
 */

const SITE_ROOT = process.cwd();
const REPO_ROOT = path.resolve(SITE_ROOT, "..");

const DEFAULT_STATUS_URL = "https://raw.githubusercontent.com/eziee-ai/cryptomcp/status/status.json";

const REGISTRY_ROOT = process.env.CRYPTOMCP_REGISTRY_DIR ? path.resolve(SITE_ROOT, process.env.CRYPTOMCP_REGISTRY_DIR) : path.resolve(REPO_ROOT, "registry");

const STATUS_URL = process.env.CRYPTOMCP_STATUS_URL ?? DEFAULT_STATUS_URL;

const CHAINS_PATH = path.resolve(REPO_ROOT, "chains.json");

/** Every merged protocol, parsed again by the kit. Throws and fails the build when any entry does not parse. */
export const registry: RegistryEntry[] = loadRegistry(REGISTRY_ROOT);

/** The maintainer-owned chain allowlist: id -> name, RPC (unused by the site) and explorer URL. */
export const chains: Chains = loadChains(CHAINS_PATH);

async function readStatusFile(fileUrl: string): Promise<string | null> {
  const filePath = fileURLToPath(fileUrl);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * `status.json`, from the `status` branch over HTTPS, or from disk when `CRYPTOMCP_STATUS_URL` starts with
 * `file:` (how the build test points at a fixture). A 404 (or a missing fixture file) is an empty status: the
 * branch has not been created yet. Any other failure — network error, a non-2xx status, invalid JSON, a status
 * that does not parse — throws and fails the build, so Vercel keeps serving the last good deployment instead of a
 * fresh one with no proven state.
 */
async function fetchStatus(url: string, now: string): Promise<Status> {
  if (url.startsWith("file:")) {
    const text = await readStatusFile(url);
    if (text === null) return EMPTY_STATUS(now);
    return parseStatus(JSON.parse(text));
  }
  const response = await fetch(url);
  if (response.status === 404) return EMPTY_STATUS(now);
  if (!response.ok) throw new Error(`status fetch failed: ${url} responded ${response.status} ${response.statusText}`);
  return parseStatus(await response.json());
}

export const status: Status = await fetchStatus(STATUS_URL, new Date().toISOString());

export type DisplayState = "conformant" | "failing" | "unchecked";

const STATE_ORDER: Record<DisplayState, number> = { conformant: 0, failing: 1, unchecked: 2 };

/** This protocol's status row, or `undefined` when nothing has ever checked it (also shown as "unchecked"/Listed). */
export function statusFor(id: string): ProtocolStatus | undefined {
  return status.protocols[id];
}

export function stateFor(id: string): DisplayState {
  return statusFor(id)?.state ?? "unchecked";
}

/** Registry entries sorted the way the directory shows them: conformant, then failing, then unchecked; by name within each. */
export function sortedRegistry(): RegistryEntry[] {
  return [...registry].sort((a, b) => {
    const order = STATE_ORDER[stateFor(a.id)] - STATE_ORDER[stateFor(b.id)];
    if (order !== 0) return order;
    return a.manifest.name.localeCompare(b.manifest.name);
  });
}

export function explorerFor(chainId: number): { name: string; explorer: string } | null {
  const chain = chains[String(chainId)];
  return chain ? { name: chain.name, explorer: chain.explorer } : null;
}

export function chainName(chainId: number): string {
  return chains[String(chainId)]?.name ?? String(chainId);
}

export function addressUrl(chainId: number, address: string): string | null {
  const chain = chains[String(chainId)];
  if (!chain) return null;
  return `${chain.explorer.replace(/\/$/, "")}/address/${address}`;
}

export interface RegistryJsonEntry {
  id: string;
  name: string;
  homepage: string;
  chains: number[];
  actions: string[];
  state: DisplayState;
  checkedAt: string | null;
  fromTemplate: boolean | null;
  repo: string;
}

/** The shape written to `/registry.json` (spec section 8), one row per protocol. */
export function toRegistryJson(entry: RegistryEntry): RegistryJsonEntry {
  const row = statusFor(entry.id);
  const state = stateFor(entry.id);
  return {
    id: entry.id,
    name: entry.manifest.name,
    homepage: entry.manifest.homepage,
    chains: entry.manifest.chains,
    actions: Object.keys(entry.manifest.actions),
    state,
    // "checkedAt is null when unchecked" (spec section 8): the live-check's own `unchecked` row still carries a
    // `checkedAt` (ProtocolStatus requires one; it is set to the run's timestamp when no MCP_KEY is stored, per
    // the implementation plan's Task 5), so this cannot be a plain `row?.checkedAt ?? null` — that would leak a
    // non-null value for a protocol that was never actually checked.
    checkedAt: state === "unchecked" ? null : (row?.checkedAt ?? null),
    fromTemplate: row?.fromTemplate ?? null,
    repo: entry.entry.repo,
  };
}

export function entryById(id: string): RegistryEntry | undefined {
  return registry.find((entry) => entry.id === id);
}
