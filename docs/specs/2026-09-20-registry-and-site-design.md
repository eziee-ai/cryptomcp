# cryptomcp: the protocol registry and cryptomcp.io

Status: Design, 2026-09-20. Owner decisions in §1 are settled. Open owner decisions are in §11.

## 1. What this is

Protocols join eziee by hosting an MCP server and submitting a manifest
([protocol-mcp-template](https://github.com/eziee-ai/protocol-mcp-template), guideline §7). Today there is nowhere to
submit to: the eziee app is private. This repository is that place, and the website that shows the result.

Settled with the owner on 2026-09-20:

| Decision | Choice |
|---|---|
| What a merged entry means | **Single intake.** Every protocol submits here. Merged means Listed. The eziee app later pulls manifests from this repository at a pinned commit to make them Verified in the wallet (§10, a separate spec). |
| How live conformance is proven | Keyless checks on the pull request. After merge, a scheduled job on `main` runs full conformance against the live server with a key held as a repository secret. |
| Whose site it is | eziee's directory, in eziee's identity. |
| Hosting | Vercel, team **Hyungsuk Kang** (`digitalnative`). DNS is the owner's Cloudflare zone for `cryptomcp.io`. |

Non-goals: listing MCP servers that do not target eziee; accounts, comments or ratings; any write path other than a
pull request.

## 2. Repository layout

`eziee-ai/cryptomcp`, public.

```
registry/<id>/manifest.json   the protocol manifest, exactly as eziee's parseManifest accepts it
registry/<id>/samples.json    one sample intent per action
registry/<id>/icon.svg        inert SVG, at most 8 KB
registry/<id>/entry.json      what the manifest does not carry (§3)
chains.json                   maintainer-owned allowlist: chain id -> name, public RPC URL, explorer URL
kit/                          eziee's checking code, copied from protocol-mcp-template (§4)
kit.lock                      the template commit kit/ was copied from
validator/                    the pull request validator and its tests (§5)
live-check/                   the scheduled conformance runner (§7)
site/                         the static site, Astro with no client JavaScript (§8)
.github/                      workflows, CODEOWNERS, pull request template, dependabot
```

A second branch, `status`, holds one file, `status.json`, written only by the live check (§7). It shares no history
with `main`.

## 3. `entry.json`

```json
{
  "repo": "https://github.com/yourorg/yourprotocol-mcp",
  "commit": "<40 hex>",
  "tagline": "One line, at most 80 characters",
  "links": { "docs": "https://…", "x": "https://…" },
  "maintainers": ["github-login", "another-login"]
}
```

- `repo` is a public GitHub repository. `commit` is a commit in it whose `registry/<id>/manifest.json` is byte for
  byte the manifest in the pull request. This ties a listing to public source a reviewer can read.
- `maintainers` are the GitHub logins allowed to change this entry later. The first submission's author must be in
  the list.
- `links` values are `https:` URLs. Keys are limited to `docs`, `app`, `x`, `discord`, `github`.
- Strict schema: an unknown key is an error, as in the manifest.

Name, homepage, chains, contracts, tokens and actions come from the manifest and are never repeated here.

## 4. The check kit

The validator and the live check use eziee's own code: `parseManifest`, `checkChain`, `checkServer`, `acceptBuild`.
The one public copy of that code is `kit/` in protocol-mcp-template. This repository copies it with
`pnpm sync-kit <commit>`, which writes the files and records the commit in `kit.lock`. The commit must be on the
template's `main` (GitHub serves a fork's commits from the upstream URL too). `pnpm sync-kit --check` fails if `kit/`
differs by one byte from the template at the locked commit. It runs in ordinary CI from the pull request's own code,
so it is a tripwire for honest mistakes; what protects `kit/` from a hostile change is its code owners. Moving to a newer kit is a reviewed
pull request that changes `kit.lock` and `kit/` together.

## 5. The pull request validator

### 5.1 Trust model

A pull request from a fork is hostile input. Three properties must hold:

1. **No secret is reachable.** The workflow references none, and its token is `contents: read`,
   `pull-requests: write`.
2. **The result cannot be forged.** The workflow runs on `pull_request_target`, so the workflow file and the
   validator are the ones on `main`. A pull request that edits either changes nothing about how it is judged.
   Everything read from `main` (an entry's maintainers, the files a pull request leaves alone) is read at `main`'s
   commit at the moment of the run, never at the event's `base.sha`, which goes stale as soon as anything merges.
3. **No code from the pull request runs.** The job checks out `main` and nothing else. It reads the pull request's
   changed files through the GitHub API as bytes, into memory. It never checks out the head, never installs from it,
   never imports, renders or executes anything in it. Everything it does to those bytes is parsing: `JSON.parse`,
   zod, a text scan of the SVG.

`pull_request_target` is dangerous precisely when rule 3 is broken. The workflow file says so at its top, and a test
asserts the workflow contains no `ref:` pointing at the pull request and no `actions/checkout` of the head.

### 5.2 What it checks

In order. The first failure in the path guard stops the run; later groups all run so one report lists everything.

**Path guard**
- Every changed file is under one `registry/<id>/` folder, and is one of the four allowed names. A pull request that
  touches anything else is not a submission: the validator says so, fails, and leaves it to code owners.
- No renames, no deletions of another entry, no symlinks or submodules (mode `120000`, `160000`), at most 4 files.
- `<id>` matches `^[a-z0-9][a-z0-9-]{0,31}$` and equals `manifest.id`.
- Sizes: manifest at most 64 KB, samples 16 KB, entry 4 KB, icon 8 KB.
- If `registry/<id>/` already exists on `main`, the author must be in that entry's `maintainers` on `main`. The list
  in the pull request is not consulted for this.

**Manifest and entry**
- `parseManifest` from the kit, unmodified. `entry.json` and `samples.json` against their strict schemas.
- Every action in the manifest has a sample, and every sample names an action in the manifest.
- Every chain in the manifest is in `chains.json`. A new chain is a separate maintainer pull request.
- `manifest.mcp.url` is present and `https:`.

**Icon**
- Parses as XML with a single `svg` root. Rejected: `script`, `foreignObject`, `iframe`, `image`, `use` with an
  external `href`, any `on*` attribute, any `href`/`xlink:href` that is not a same-document `#id`, `style` elements
  and attributes containing `url(` or `@import`, DOCTYPE, entities, processing instructions.

**Onchain, through `chains.json` only**
- `checkChain` from the kit: every contract has code, its proxy type is as declared, a transparent proxy's admin is
  the one the chain names, every token answers `symbol()` and `decimals()` as declared.
- The only hosts connected to are the RPC URLs in `chains.json` on `main` and `api.github.com`. No URL taken from the
  pull request is ever fetched, so the pull request cannot make the runner call anything.

**Identity** (added after the security review, 2026-09-20: without it, `id: uniswap` with someone else's homepage
passed every check)
- A first submission may not use a name in `reserved.json`, as its id or at the start of its display name.
- `mcp.url` is on the homepage's host or a subdomain of it, and the homepage is on a DNS name, not an IP address.
- A DNS TXT record at `_cryptomcp.<homepage host>` holds `cryptomcp-repo=<owner>/<repository>` for `entry.repo`.
  This is one lookup through the runner's resolver; nothing is fetched from the domain. The live check (§7) asks
  again daily.

**Source link, through `api.github.com` only**
- `entry.repo` exists and is public; `registry/<id>/manifest.json` at `entry.commit` equals the submitted manifest.
- Notes, not failures: whether the repository was created from protocol-mcp-template, and whether the pull request's
  author has commits in it. A reviewer weighs these.

### 5.3 The report

One comment, edited in place on each push. Each check is `pass`, `FAIL`, `not run` or `note`; `not run` is never
shown as a pass. Text taken from the submission is passed through the kit's `clean`, capped, and placed in code
spans, so a manifest cannot inject markdown, mentions or links into the comment. The report ends with the checks a
human still owes (§6).

The job's conclusion is the required status check `registry / validate`.

## 6. Review and merge

A green validator is necessary and not sufficient. The pull request template carries the reviewer's checklist, from
guideline §4a and §7:

- Each manifest `abi` matches the contract's verified source on its explorer: same function, names and types.
- Each spending action, simulated on a forked chain: what leaves the signer equals the decoded spend.
- Address sources are the protocol's own, and proxy admin risk is acceptable.
- The submitter is who they say they are.

Merging is by a code owner. After merging, the maintainer obtains the protocol's server key privately and stores it
as `MCP_KEY_<ID>` (id upper-cased, `-` to `_`) in the `live-check` environment.

## 7. The scheduled live check

`.github/workflows/live-check.yml`: `schedule` (daily) and `workflow_dispatch`. It runs only from `main`; the
`live-check` environment is restricted to that branch, so its secrets are unreachable from any other ref.

- A first job lists `registry/*` on `main` into a matrix. Each matrix job receives exactly one key,
  `secrets[format('MCP_KEY_{0}', matrix.key)]`.
- Each job runs the kit's `checkServer` against `manifest.mcp.url` with the merged `samples.json`, and `checkChain`.
  The kit's caller is HTTPS only, follows no redirect, and stops reading at 64 KB, so the key goes to the reviewed URL
  and nowhere else.
- It also records, from the GitHub API, whether `entry.repo` was created from protocol-mcp-template.
- A final job assembles `status.json` and pushes it to the `status` branch, then calls the Vercel deploy hook
  (a secret in the same environment). `main` is never written by automation and needs no bypass.

```json
{ "generatedAt": "2026-09-20T00:00:00Z",
  "protocols": { "<id>": { "state": "conformant", "checkedAt": "…", "since": "…", "fromTemplate": true,
                           "summary": { "pass": 9, "fail": 0, "notRun": 2 }, "failures": [] } } }
```

`state` is `conformant`, `failing` or `unchecked` (no key stored yet). `since` is when the current state began.
`failures` holds check names and cleaned, capped details. A protocol that has been `failing` for 14 days may be
delisted by a maintainer's pull request; nothing delists automatically.

## 8. The site

`site/`: Astro, static output, and **no client-side JavaScript at all**. A directory needs none: the theme follows
`prefers-color-scheme` in CSS, and with this few entries there is nothing to filter. The eziee app is Next.js, but a
statically exported Next.js page boots from inline scripts, which forces `script-src 'unsafe-inline'` or per-page
hashes. Shipping no script makes the strongest policy, `script-src 'none'`, true by construction. No server code and
no environment secrets either.

| Route | Content |
|---|---|
| `/` | The directory: icon, name, tagline, chains, action titles, state. Sorted conformant first, then by name. |
| `/p/<id>` | The manifest for humans: contracts with explorer links, role and proxy type; tokens; each action with its function signature and what it spends and receives; state with dates; links to the protocol's repository at the listed commit and to its registry folder. |
| `/submit` | How to join: the template, then a pull request here, then what review checks. |
| `/registry.json` | `{ id, name, homepage, chains, actions, state, checkedAt, fromTemplate, repo }` per protocol, written as a static file at build. |

States as shown: **Conformant**, with the date checked; **Failing**, with the date it began; **Listed** for
`unchecked`. Listed makes no claim about the live server, and the page says so.

**Build.** Reads `registry/` from the checkout and parses every manifest again with the kit; a manifest that does
not parse fails the build. Fetches `status.json` from the `status` branch over HTTPS. If that fetch fails for any
reason other than the branch not existing yet, the build fails: Vercel keeps serving the last deployment, whose
states were true, in preference to a fresh one with none.

**Untrusted content.** Everything from a submission is rendered as text. `homepage`, `repo` and `links` are rendered
as links only when `https:`, with `rel="noopener noreferrer nofollow"`. Icons are served as files and shown with
`<img>`, which does not run scripts. `vercel.json` sets `Content-Security-Policy: default-src 'none'; img-src 'self';
style-src 'self'; font-src 'self'; script-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
plus `X-Content-Type-Options`, `Referrer-Policy` and HSTS. Stylesheets are emitted as files
(`build.inlineStylesheets: 'never'`) and both fonts are self-hosted, so nothing needs an exception. `/registry/*.svg` is additionally served with
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so opening an icon directly runs
nothing either.

**Look.** eziee's identity as recorded in the app's `DESIGN.md`: ink canvas `#10120F`, chalk text `#F3F4ED`, acid
lime `#D7F43B` for the mark and the one primary action, Satoshi for identity and UI, DM Mono for addresses, amounts
and signatures. Dark and light, following the visitor's system setting. State colours are semantic (green, amber, red) and never the
brand lime. The header carries the wordmark from `eziee-ai/.github`.

**Hosting.** One Vercel project on team `digitalnative`, root directory `site/`, connected to this repository:
production from `main`, previews for pull requests with fork protection on. `cryptomcp.io` is the production
domain and `www` redirects to it. The DNS records are the ones Vercel states for the domain, created in the
Cloudflare zone as DNS-only so Vercel issues and renews the certificate.

## 9. Hardening the repository

- Ruleset on `main`: pull request required; one approval from a code owner; **stale approvals dismissed on a new
  push, and the most recent push must itself be approved by someone other than its author**; required checks
  `validate` (workflow `registry`) and `check` (workflow `ci`), with the branch up to date before merging; linear
  history; no force push; no deletion; an empty bypass list. The `status` branch: no force push, no deletion.
  The approval rules matter more than they look. The validator proves an address has code, not that it is the
  contract a reviewer read, so an approval must never outlive the commit it was given for.
- Requiring approval for fork pull request workflows does not gate `pull_request_target`; `validate.yml` runs at
  once for anyone. That is safe only because of §5.1, and is why §5.1 is pinned by tests.
- `CODEOWNERS`: `*` and, explicitly, `/.github/`, `/validator/`, `/kit/`, `/chains.json`, `/site/`, `/live-check/`
  to the eziee maintainers. `registry/` needs a maintainer's approval too; the difference is that the validator
  judges it.
- Actions: every third-party action pinned to a commit SHA; workflow token default read-only; workflows from outside
  collaborators require approval; Dependabot for actions and npm.
- Secret scanning with push protection, private vulnerability reporting, `SECURITY.md`.
- The Vercel project has no environment variables, so a preview build has nothing to leak.

## 10. The template repository, and what comes later

In `eziee-ai/protocol-mcp-template`:

- README "Submit" section: replaced with the real process, a pull request to this repository.
- README "Built with this template": a marked section regenerated from `https://cryptomcp.io/registry.json`,
  listing protocols with `fromTemplate: true`, each linking to its repository and its page. A workflow does this on a
  daily schedule and on `workflow_dispatch`, with `if: github.repository == 'eziee-ai/protocol-mcp-template'` so it
  does nothing in a team's copy. It needs only that repository's own token. No token anywhere can write across
  repositories.

Later, in the eziee app, its own spec: a `vendor-registry` script that copies `registry/*/manifest.json` from this
repository at a pinned commit into `VERIFIED_MANIFESTS`, the way `vendor-iter` does for Iter. Being Listed here does
not change what the wallet will sign until that lands and a release pins a commit.

## 11. Open owner decisions

These do not block the build. They block telling people to submit.

- **Licence.** Neither public repository has one. Submitters need to know under what terms their manifest is
  redistributed, and nobody may legally build on the template without one.
- **Listing criteria beyond conformance** (audits, TVL, jurisdiction), already open in guideline §8.
- **Who the code owners are.** Until named, it is the org's one admin, and a second reviewer is worth having before
  the first outside submission.

## 12. Testing and acceptance

Validator unit tests, each a fixture pull request expressed as a list of changed files with bytes:
a valid submission; a file outside `registry/`; two ids at once; a changed workflow; `../` and absolute paths; a
symlink mode; an oversized manifest; an id that differs from the folder; an update by a login not in `maintainers`
on `main` though present in the pull request; a chain not in `chains.json`; an action without a sample; every SVG
rejection in §5.2, each alone; a manifest whose text tries to inject markdown into the report.

A workflow test asserts the `pull_request_target` workflow never checks out the pull request. The live check is
tested against protocol-mcp-template's example server started in-process. The site build is tested with a registry
of fixtures including hostile strings, and asserts that none reaches the HTML unescaped and that no page contains a
`<script>` element or an inline event handler.

Before the repository is made public, a separate reviewer audits §5, §7 and §9 as built.

Done means: a pull request from a fork adding the template's example protocol gets a correct report and a green
check; one touching `.github/` gets a red one; merging the first makes it appear on `https://cryptomcp.io` as
Listed without anyone touching Vercel; storing its key and dispatching the live check turns it Conformant; stopping
its server and dispatching again turns it Failing; the template README lists it after its workflow runs.
