/**
 * kit/ is eziee's own checking code. Its one public source is `kit/` in eziee-ai/protocol-mcp-template, and this
 * repository may only ever hold an exact copy of it at the commit recorded in kit.lock (spec §4).
 *
 *   pnpm sync-kit <40-hex commit>   copy kit/ from the template at that commit and record it
 *   pnpm sync-kit --check           exit 1 if kit/ differs by one byte from the template at the recorded commit
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = "https://github.com/eziee-ai/protocol-mcp-template.git";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function filesUnder(root: string, dir = root): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(root, path) : [relative(root, path)];
    })
    .sort();
}

/** What is wrong with `actual` measured against `expected`, file by file, byte for byte. */
export function diffTrees(expected: string, actual: string): string[] {
  const want = filesUnder(expected);
  const have = filesUnder(actual);
  const problems: string[] = [];
  for (const file of want) {
    if (!have.includes(file)) problems.push(`${file} is missing`);
    else if (!readFileSync(join(expected, file)).equals(readFileSync(join(actual, file)))) problems.push(`${file} differs`);
  }
  for (const file of have) if (!want.includes(file)) problems.push(`${file} is not in the template's kit`);
  return problems.sort();
}

function fetchKit(commit: string): string {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("the commit must be a full 40-character SHA");
  const dir = mkdtempSync(join(tmpdir(), "kit-sync-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  git("init", "-q");
  git("fetch", "-q", "--depth", "1", TEMPLATE, commit);
  git("checkout", "-q", "FETCH_HEAD", "--", "kit");
  return join(dir, "kit");
}

function main(): void {
  const arg = process.argv[2];
  if (arg === "--check") {
    const commit = readFileSync(join(ROOT, "kit.lock"), "utf8").trim();
    const problems = existsSync(join(ROOT, "kit")) ? diffTrees(fetchKit(commit), join(ROOT, "kit")) : ["kit/ does not exist"];
    if (problems.length === 0) return console.log(`kit/ matches protocol-mcp-template at ${commit}`);
    console.error(`kit/ does not match protocol-mcp-template at ${commit}:\n${problems.map((problem) => `  ${problem}`).join("\n")}\nkit/ is never edited here. Run pnpm sync-kit <commit>.`);
    process.exit(1);
  }
  if (!arg) throw new Error("usage: pnpm sync-kit <commit> | --check");
  const source = fetchKit(arg);
  rmSync(join(ROOT, "kit"), { recursive: true, force: true });
  cpSync(source, join(ROOT, "kit"), { recursive: true });
  writeFileSync(join(ROOT, "kit.lock"), `${arg}\n`);
  console.log(`kit/ copied from protocol-mcp-template at ${arg}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
