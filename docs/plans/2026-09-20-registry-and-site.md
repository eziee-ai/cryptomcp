# Protocol Registry and cryptomcp.io Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public repository where protocols submit their eziee manifest by pull request, judged by a validator that cannot be forged and runs no submitted code, with a static site at cryptomcp.io that shows what was merged and whether each live server still conforms.

**Architecture:** One repository, `eziee-ai/cryptomcp`. `registry/<id>/` is data. `validator/` judges a pull request from `pull_request_target`, reading the changed files through the GitHub API as bytes. `live-check/` runs eziee's conformance on a schedule from `main` with per-protocol keys and writes `status.json` to a `status` branch. `site/` is an Astro static site with no client JavaScript that reads `registry/` from the checkout and `status.json` over HTTPS at build.

**Tech Stack:** Node 22, pnpm 10 workspace, TypeScript, tsx, vitest, zod 3.25.76, viem 2, fast-xml-parser 5, Astro 7, GitHub Actions, Vercel, Cloudflare DNS.

**Spec:** `docs/specs/2026-09-20-registry-and-site-design.md`

## Global Constraints

- `kit/` is copied from `eziee-ai/protocol-mcp-template` at the commit in `kit.lock` and is never edited. First lock: `c1df5263f4aa21c84442f9890df25982852ee2ed`.
- The `pull_request_target` job never checks out, installs, imports or executes anything from the pull request. It references no secret. Token: `contents: read`, `pull-requests: write`.
- The validator contacts only the RPC URLs in `chains.json` on `main` and `api.github.com`. No URL from a submission is fetched by it.
- Every third-party action is pinned to a commit SHA: `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`, `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1`, `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`, `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`.
- Installs in CI use `pnpm install --frozen-lockfile --ignore-scripts`.
- No address, SHA or DNS value is typed from memory. Each is read from the system that owns it at the time it is used.
- The site ships no `<script>` and no inline event handler. Text from a submission is rendered as text. Links are rendered only when `https:`.
- Limits: manifest 64 KB, samples 16 KB, entry 4 KB, icon 8 KB, at most 4 files per submission, id `^[a-z0-9][a-z0-9-]{0,31}$`.
- "Not run" is never reported as a pass, anywhere.
- No protocol is listed on production that is not a real submission. The registry launches empty.

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.json, .nvmrc, .gitignore, vitest.config.ts
kit/, kit.lock                     copied; scripts/sync-kit.ts writes and checks them
chains.json                        { "<chainId>": { name, rpc, explorer } }
lib/entry.ts                       entrySchema, samplesSchema, parseEntry, parseSamples
lib/chains.ts                      parseChains, loadChains
lib/svg.ts                         iconProblems(bytes): string[]
lib/registry.ts                    loadRegistry(root): RegistryEntry[]
lib/status.ts                      Status types, assembleStatus(previous, results, now)
validator/pathGuard.ts             guardPaths(files, association, author)
validator/validate.ts              validateSubmission(input, deps): Finding[]
validator/report.ts                renderReport(findings, meta): string
validator/github.ts                GitHub REST client: the five calls the validator makes
validator/main.ts                  the workflow's entry point
live-check/run.ts, assemble.ts     one protocol's check; merge into status.json
test/                              one test file per unit, fixtures/, fixtures/server.ts
site/                              Astro project (Task 6)
.github/workflows/{validate,ci,live-check}.yml, CODEOWNERS, PULL_REQUEST_TEMPLATE.md, dependabot.yml
SECURITY.md, README.md, CONTRIBUTING.md
```

Shared type, from the kit and reused everywhere: `Finding { check: string; status: "pass" | "fail" | "not-run" | "note"; detail: string; manual?: true }`.

---

### Task 1: Scaffold and the locked kit

**Files:** Create `package.json`, `pnpm-workspace.yaml` (`packages: ["site"]`), `tsconfig.json`, `vitest.config.ts`, `.nvmrc` (22), `.gitignore`, `scripts/sync-kit.ts`, `kit.lock`, `kit/`, `test/syncKit.test.ts`.

**Interfaces — Produces:** `pnpm sync-kit <sha>` writes `kit/` and `kit.lock`; `pnpm sync-kit --check` exits 1 when `kit/` differs from the template at the locked commit. Root scripts: `typecheck`, `test`, `validate`, `live-check`, `assemble-status`, `sync-kit`.

- [ ] Write `test/syncKit.test.ts`: `diffTrees(a, b)` reports an added file, a removed file and a changed byte; identical trees give `[]`.
- [ ] Run `pnpm test` and see it fail on the missing module.
- [ ] Write `scripts/sync-kit.ts`: `git init` a temp dir, `git fetch --depth 1 https://github.com/eziee-ai/protocol-mcp-template.git <sha>`, `git checkout FETCH_HEAD -- kit`, then copy (write mode) or `diffTrees` (check mode). The SHA must match `^[0-9a-f]{40}$`.
- [ ] Run `pnpm sync-kit c1df5263f4aa21c84442f9890df25982852ee2ed`, then `pnpm sync-kit --check` (exit 0), then append a byte to `kit/text.ts` and see exit 1; restore.
- [ ] `pnpm typecheck && pnpm test`, commit.

### Task 2: Schemas, chains, and the icon check

**Files:** Create `lib/entry.ts`, `lib/chains.ts`, `lib/svg.ts`, `chains.json`, `test/entry.test.ts`, `test/chains.test.ts`, `test/svg.test.ts`.

**Interfaces — Produces:**
- `parseEntry(input: unknown): Entry` where `Entry = { repo: string; commit: string; tagline: string; links?: Partial<Record<"docs"|"app"|"x"|"discord"|"github", string>>; maintainers: string[] }`. Strict. `repo` matches `^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`; `commit` is 40 hex; `tagline` 1 to 80 characters with no control characters; `maintainers` 1 to 5 logins matching `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`; link values parse as URLs with protocol `https:`. Throws `Error` listing every problem.
- `parseSamples(input: unknown): Record<string, { chainId: number; intent: Record<string, unknown> }>`. Strict.
- `parseChains(input: unknown): Record<string, { name: string; rpc: string; explorer: string }>`; both URLs `https:`.
- `iconProblems(bytes: Uint8Array): string[]`; empty means acceptable.

`chains.json` starts with the chains eziee supports today, each RPC URL taken from that chain's own documentation at the time of writing and recorded with its source in `CONTRIBUTING.md`. `test/chains.test.ts` parses the real file.

- [ ] Write the three test files. `svg.test.ts` has one case per rejection in spec §5.2, each alone, plus: not XML, two roots, a root that is not `svg`, over 8 KB, a UTF-16 BOM, `href="#a"` accepted, a plain icon accepted, and an `<a>` element rejected.
- [ ] See them fail, implement, see them pass. `iconProblems` parses with fast-xml-parser (`ignoreAttributes: false`, `processEntities: false`, `allowBooleanAttributes: true`) after refusing, on the raw text, `<!DOCTYPE`, `<!ENTITY` and `<?` other than a leading `<?xml`. It walks every element against an ALLOWLIST of element names (`svg g path circle ellipse rect line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc use`) and refuses every attribute that starts with `on`, every `href`/`xlink:href` that is not `#id`, and every `style` attribute or attribute value containing `url(`, `@import`, `javascript:` or `expression(`.
- [ ] Commit.

### Task 3: The validator

**Files:** Create `validator/pathGuard.ts`, `validator/validate.ts`, `validator/report.ts`, `validator/github.ts`, `validator/main.ts`, and `test/pathGuard.test.ts`, `test/validate.test.ts`, `test/report.test.ts`.

**Interfaces — Produces:**
- `type ChangedFile = { filename: string; status: "added"|"modified"|"removed"|"renamed"|"copied"|"changed"|"unchanged"; previous_filename?: string }`
- `guardPaths(files: ChangedFile[], author: { login: string; association: string }): { kind: "submission"; id: string } | { kind: "maintainer-change" } | { kind: "refused"; problems: string[] }`. A change set with no path under `registry/` is `maintainer-change` when `association` is `OWNER`, `MEMBER` or `COLLABORATOR`, or the login is `dependabot[bot]`; otherwise `refused`. Any mix of `registry/` and other paths is `refused` for everyone.
- `validateSubmission(input: { id: string; author: string; files: Map<string, Uint8Array>; removed: string[]; existingMaintainers: string[] | null; chains: Chains }, deps: { clientFor(chainId: number): PublicClient; github: Pick<GitHub, "getRepo"|"getFile"|"hasCommitsBy"> }): Promise<Finding[]>`
- `renderReport(findings: Finding[], meta: { id?: string; sha: string }): string`, starting with the marker `<!-- cryptomcp-validate -->`.
- `GitHub` with `listPrFiles(pr)`, `getFile(repo, path, ref): Promise<{ type: string; size: number; bytes: Uint8Array } | null>`, `getRepo(repo)`, `hasCommitsBy(repo, login)`, `upsertComment(pr, marker, body)`. Every request goes to `https://api.github.com`, with `redirect: "error"`.

`pathGuard.test.ts` cases: a valid four-file add; `registry/a/manifest.json` plus `README.md`; two ids; `.github/workflows/validate.yml` from `NONE` (refused) and from `OWNER` (maintainer-change); `registry/../x`, `/registry/a/manifest.json`, `registry/a/b/manifest.json`, `registry/a/extra.json`, `registry/A/manifest.json`; a rename from another entry; removal of `manifest.json`; five files; `dependabot[bot]` on `package.json`.

`validate.test.ts` cases, each against a fixture and a fake `PublicClient` and `github`: the valid submission yields no `fail`; folder id differs from `manifest.id`; oversized manifest; manifest that does not parse; missing `mcp.url`; `http:` `mcp.url`; action without sample; sample without action; chain not in `chains.json`; contract without code; token with the wrong decimals; author not in the submitted `maintainers` on a first submission; update by a login absent from `existingMaintainers` though present in the submitted list; `entry.commit` whose manifest differs; private or missing `entry.repo`; `getFile` returning `type: "symlink"` for a submitted path; a bad icon. Notes: not created from the template; author has no commits in the repo.

`report.test.ts`: a manifest name of ``"`](https://evil) @everyone <img src=x>"`` reaches the report only inside a code span with backticks, brackets and angle brackets removed; `not-run` renders as "not run"; the manual checklist is always present; the marker is first.

- [ ] Tests first for each unit, see them fail, implement, see them pass, commit per unit.
- [ ] `validator/main.ts`: read `GITHUB_EVENT_PATH`, require `pull_request` in it, list files (one page of 100; more than 4 under a submission is a refusal), run `guardPaths`, read each file with `getFile(baseRepo, path, headSha)` (refuse `type !== "file"` and sizes over the limits before decoding), read `existingMaintainers` from `registry/<id>/entry.json` at the BASE sha, run `validateSubmission`, upsert the comment, exit 1 when any finding is `fail` or the guard refused. A thrown error is reported as one `fail` finding with a generic detail and logged in full.

### Task 4: Workflows and repository files

**Files:** Create `.github/workflows/validate.yml`, `.github/workflows/ci.yml`, `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`, `SECURITY.md`, `CONTRIBUTING.md`, `README.md`, `test/workflows.test.ts`.

`validate.yml`:

```yaml
# pull_request_target runs with this repository's token in the context of the BASE branch. It is safe here for one
# reason only: nothing from the pull request is ever checked out, installed, imported or executed. The validator
# reads the changed files through the GitHub API as bytes. Do not add `ref:` to the checkout. Do not add a secret.
name: registry
on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]
permissions: {}
concurrency:
  group: validate-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version-file: .nvmrc
      - run: pnpm install --frozen-lockfile --ignore-scripts --filter .
      - run: pnpm validate
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

`test/workflows.test.ts` parses every workflow with `yaml` and asserts: `validate.yml` triggers only on `pull_request_target`; no step in it has `with.ref`, and no string in it contains `github.event.pull_request.head`, `github.head_ref` or `secrets.`; top-level `permissions` is `{}`; every `uses:` in every workflow is pinned to 40 hex; `ci.yml` never triggers on `pull_request_target`; `live-check.yml` triggers only on `schedule` and `workflow_dispatch` and every job that reads a secret declares `environment: live-check`.

`ci.yml` (`pull_request`, `push` to `main`; `permissions: contents: read`): install, `pnpm typecheck`, `pnpm test`, `pnpm sync-kit --check`, `pnpm --filter site build`.

`CODEOWNERS`: `* @hskang9`, then each of `/.github/ /validator/ /lib/ /kit/ /kit.lock /chains.json /site/ /live-check/ /scripts/` explicitly. The reviewer checklist of spec §6 is the body of `PULL_REQUEST_TEMPLATE.md`.

- [ ] Workflow test first, then the files, `pnpm test`, commit.

### Task 5: The live check

**Files:** Create `lib/registry.ts`, `lib/status.ts`, `live-check/run.ts`, `live-check/assemble.ts`, `.github/workflows/live-check.yml`, `test/fixtures/server.ts`, `test/liveCheck.test.ts`, `test/status.test.ts`, `test/registry.test.ts`.

**Interfaces — Produces:**
- `loadRegistry(root: string): RegistryEntry[]`, `RegistryEntry = { id; manifest: Manifest; entry: Entry; samples; iconPath: string }`, sorted by id; throws when any entry does not parse.
- `secretNameFor(id: string): string` → `MCP_KEY_` + id upper-cased with `-` → `_`.
- `type ProtocolStatus = { state: "conformant"|"failing"|"unchecked"; checkedAt: string; since: string; fromTemplate: boolean | null; summary: { pass: number; fail: number; notRun: number }; failures: Array<{ check: string; detail: string }> }`
- `type Status = { generatedAt: string; protocols: Record<string, ProtocolStatus> }`
- `assembleStatus(previous: Status | null, results: Record<string, Omit<ProtocolStatus, "since">>, now: string): Status`. `since` carries over while `state` is unchanged. A protocol no longer in the registry is dropped.
- `pnpm live-check <id>` writes `out/<id>.json`; with no `MCP_KEY` in the environment the state is `unchecked` and no request is sent to the server.

`test/fixtures/server.ts` is a stateless MCP server in the shape of guideline §5 that builds honest calldata with viem for a fixture manifest; a flag makes it answer with an unlimited approval. `liveCheck.test.ts`: honest server → `conformant`; dishonest → `failing` with the approval check named; no key → `unchecked` and the server saw zero requests; failure details pass through the kit's `clean` and are capped at 200 characters.

`live-check.yml`: job `list` emits the matrix from `registry/*`; job `check` (`environment: live-check`, `strategy.fail-fast: false`) sets `MCP_KEY: ${{ secrets[format('MCP_KEY_{0}', matrix.key)] }}`, runs `pnpm live-check ${{ matrix.id }}` and uploads `out/`; job `publish` (`environment: live-check`, `permissions: contents: write`) downloads the artifacts, checks out the `status` branch (creating it as an orphan the first time), runs `pnpm assemble-status`, commits `status.json` on every run, because `checkedAt` is the claim the site shows and must stay current; then `curl -fsS -X POST "$VERCEL_DEPLOY_HOOK"`. With an empty registry the `check` job is skipped and `publish` writes an empty status.

- [ ] Tests first, implement, pass, commit.

### Task 6: The site (runs in parallel with Tasks 3 to 5)

**Files:** everything under `site/`: `package.json`, `astro.config.mjs`, `vercel.json`, `src/layouts/Base.astro`, `src/pages/index.astro`, `src/pages/p/[id].astro`, `src/pages/submit.astro`, `src/pages/registry.json.ts`, `src/pages/404.astro`, `src/lib/data.ts`, `src/styles/tokens.css`, `src/styles/site.css`, `src/components/{Header,Footer,ProtocolCard,StateBadge,Address}.astro`, `public/eziee-wordmark-{light,dark}.svg`, `test/build.test.ts`.

**Interfaces — Consumes:** `loadRegistry` and `Status` from Task 5 (`../lib/registry`, `../lib/status`), `chains.json`. **Produces:** `pnpm --filter site build` writes `site/dist/`, including `registry.json` with the fields in spec §8 and `registry/<id>.svg` copies of the icons.

Astro 7 is newer than most training data: read the installed version's docs for static output, endpoints, `getStaticPaths` and `build.inlineStylesheets` before writing code. `src/lib/data.ts` takes the registry root and the status URL from `CRYPTOMCP_REGISTRY_DIR` and `CRYPTOMCP_STATUS_URL` so the test can point them at fixtures; the defaults are `../registry` and `https://raw.githubusercontent.com/eziee-ai/cryptomcp/status/status.json`. A 404 for the status is an empty status; any other failure throws and fails the build.

Identity: tokens copied by value from the eziee app's `DESIGN.md` (ink `#10120F`, panel `#181C16`, panel raised `#242A20`, chalk `#F3F4ED`, lime `#D7F43B`, lime ink `#485A08`, on-lime `#111310`, light canvas `#F3F4ED`, light panel `#FCFCF8`, light ink `#171A14`). Satoshi comes from Fontshare's stylesheet, the distribution its licence allows; DM Mono is self-hosted through `@fontsource/dm-mono`. This amends spec §8, which said both were self-hosted: `style-src 'self' https://api.fontshare.com; font-src 'self' https://cdn.fontshare.com`. Everything else in the policy stands, `script-src 'none'` included.

`test/build.test.ts` builds against `test/fixtures/registry` (two protocols, one named `<script>alert(1)</script>` with a tagline of `"><img src=x onerror=alert(1)>` and a `javascript:` docs link that the entry schema would refuse but the fixture injects past it) and a fixture status, then asserts over every `.html` in `dist/`: no `<script`, no ` on[a-z]+=` attribute, no `javascript:`, the hostile name present only escaped; `registry.json` parses and has both ids; the empty-registry build renders the empty state and an empty array.

- [ ] Build test first, then the site, then `pnpm --filter site build` against the real (empty) registry, commit.

### Task 7: Security review, by a separate reviewer

- [ ] A reviewer who did not write the code audits `validate.yml`, `validator/`, `lib/svg.ts`, `live-check.yml`, `live-check/`, `site/vercel.json` and `site/src/lib/data.ts` against spec §5, §7, §8 and §9, tries to break each, and reports with a verdict. Fix every must-fix, re-verify, then go on.

### Task 8: Publish and harden the repository

- [ ] `gh repo create eziee-ai/cryptomcp --public`, push `main`.
- [ ] Repository settings through `gh api`: delete branch on merge, squash only, secret scanning and push protection on, private vulnerability reporting on, Actions default token read-only, Actions may not approve pull requests, fork pull request workflows from outside collaborators require approval.
- [ ] Environment `live-check` with a deployment branch policy of `main` only.
- [ ] Ruleset on `main`, with an EMPTY bypass list: pull request with one code-owner approval, `dismiss_stale_reviews_on_push: true`, `require_last_push_approval: true`, required checks `validate` and `check` with `strict_required_status_checks_policy: true` (read the check names from the first runs before requiring them), linear history, no force push, no deletion. Ruleset on `status`: no deletion, no force push. (Security review C1: the validator cannot tell a reviewed contract from another that has code, so an approval must not survive a push.)
- [ ] Read every setting back and compare.

### Task 9: Vercel and DNS

- [ ] Create the project on team `digitalnative` with root directory `site`, framework Astro, connected to `eziee-ai/cryptomcp`; turn on Git fork protection; confirm it has no environment variables.
- [ ] Add `cryptomcp.io` and `www.cryptomcp.io` (redirect to apex). Read the records Vercel asks for, create exactly those in the Cloudflare zone with `proxied: false`, wait for Vercel to verify and issue the certificate.
- [ ] Create a deploy hook for `main`, store it as `VERCEL_DEPLOY_HOOK` in the `live-check` environment, dispatch `live-check.yml` once, confirm `status` exists and a deployment followed.
- [ ] `curl -sI https://cryptomcp.io` and check each security header against `vercel.json`.

### Task 10: The template repository

**Files (in `eziee-ai/protocol-mcp-template`):** Modify `README.md` (Submit section; add the marked "Built with this template" section), create `scripts/built-with.mjs` and `.github/workflows/built-with.yml`.

- [ ] `built-with.mjs` (no dependencies): fetch `https://cryptomcp.io/registry.json`, keep `fromTemplate === true`, write between `<!-- built-with:start -->` and `<!-- built-with:end -->` one line per protocol (name as text with markdown characters stripped, links to its repository and to `https://cryptomcp.io/p/<id>`), or "None yet. Yours could be the first." Any `repo` that is not an `https://github.com/` URL is skipped.
- [ ] The workflow: daily and `workflow_dispatch`, `if: github.repository == 'eziee-ai/protocol-mcp-template'`, `permissions: contents: write`, commits only when the README changed.
- [ ] Rewrite "Submit" to the real process, run the script, `pnpm test`, push, dispatch the workflow once.

### Task 11: End to end

- [ ] From a branch in `eziee-ai/cryptomcp`, open a pull request adding the template's example protocol. Expected: a report whose only failure is that chain 900001 is not in `chains.json`, every other check correct, check red. Close it unmerged.
- [ ] Record what production cannot show yet: Conformant and Failing are proven by `test/liveCheck.test.ts` against the fixture server, because no real protocol exists to list and a fake one is not listed.

## Self-Review

Spec coverage: §2 Task 1–6 · §3 Task 2 · §4 Task 1 · §5 Tasks 2–4 · §6 Task 4 · §7 Task 5, 9 · §8 Task 6, 9 · §9 Tasks 4, 8 · §10 Task 10 · §12 every task's tests, Task 7, Task 11. §10's eziee-app vendoring and §11's owner decisions are out of scope by the spec's own words.

Two places where this plan departs from the spec, both recorded above: Satoshi is loaded from Fontshare (licence), and a change set with no `registry/` path passes the validator for maintainers and Dependabot so that the required check does not block the repository's own maintenance, while staying red for everyone else as the spec's acceptance asks.
