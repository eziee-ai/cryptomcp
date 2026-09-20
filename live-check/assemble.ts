/**
 * pnpm assemble-status <previous status.json, or a path that does not exist> <out status.json>
 *
 * Merges this run's out/<id>.json files into the status the site reads. A protocol in the registry with no result
 * (its job crashed) is recorded as failing, because "we could not check" must never read as "conformant".
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../lib/registry";
import { assembleStatus, parseStatus, type CheckResult, type Status } from "../lib/status";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function collect(ids: string[], outDir: string, now: string): Record<string, CheckResult> {
  const results: Record<string, CheckResult> = {};
  const have = existsSync(outDir) ? readdirSync(outDir) : [];
  for (const id of ids) {
    if (have.includes(`${id}.json`)) results[id] = JSON.parse(readFileSync(join(outDir, `${id}.json`), "utf8")) as CheckResult;
    else results[id] = { state: "failing", checkedAt: now, fromTemplate: null, summary: { pass: 0, fail: 1, notRun: 0 }, failures: [{ check: "the live check completed", detail: "the check for this protocol did not finish; see the workflow run" }] };
  }
  return results;
}

function main(): void {
  const [previousPath, outPath] = process.argv.slice(2);
  if (!previousPath || !outPath) throw new Error("usage: pnpm assemble-status <previous> <out>");
  const now = new Date().toISOString();
  let previous: Status | null = null;
  if (existsSync(previousPath)) {
    try {
      previous = parseStatus(JSON.parse(readFileSync(previousPath, "utf8")));
    } catch {
      // A status file that no longer parses carries no history worth keeping. Every `since` starts again.
      previous = null;
    }
  }
  const ids = loadRegistry(join(ROOT, "registry")).map((entry) => entry.id);
  const status = assembleStatus(previous, collect(ids, join(ROOT, "out"), now), now);
  writeFileSync(outPath, `${JSON.stringify(status, null, 2)}\n`);
  console.log(`status for ${ids.length} protocol(s) written to ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
