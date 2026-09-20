/**
 * The prompt a person copies from /submit and gives to their coding agent. It is the long part of that page on
 * purpose: a person reads three lines and presses one button, and the agent reads this. Every rule a submission
 * is judged by is in here, so nothing was lost by taking it off the page. Also served as /submit-prompt.txt.
 *
 * Plain text, no markup: it is shown in a <pre>, copied to a clipboard and pasted into a terminal.
 */
export const AGENT_PROMPT = `Help me list my protocol on cryptomcp.io. That is the registry the eziee app reads to find protocols.

Work in the repository of my protocol's MCP server. Do the steps in order. Tell me what you are doing in one short line per step.

Ask me before you do anything that costs money, changes DNS, or pushes to a repository that is not mine. Never put a key, a password or a private URL in any file or pull request.

STEP 1. Start from the template.
If this repository is not built from https://github.com/eziee-ai/protocol-mcp-template, read that repository's README and docs/guideline.md. Bring over what is missing here: the manifest, the sample intents, and the kit/ folder with the checker.

STEP 2. Make the checker pass.
Run: pnpm conform --strict
It checks my manifest, my contracts onchain, and my live MCP server. Fix what it names. Do not go on until it is green.

STEP 3. Prove the domain is mine. I have to do this part, so tell me exactly what to add and wait for me.
Add a DNS TXT record:
  name:  _cryptomcp.<the domain of the homepage in my manifest>
  value: cryptomcp-repo=<owner>/<repository>   (this repository on GitHub)
My MCP server must be served from that domain or a subdomain of it.
Check it with: dig +short TXT _cryptomcp.<domain>

STEP 4. Commit the manifest in MY repository.
The file is registry/<id>/manifest.json, where <id> is the id in my manifest. Commit only that file, on a new branch, and push that branch. Do not push to my main branch without asking. Write down the full commit hash, all 40 characters.

STEP 5. Prepare the submission.
Fork https://github.com/eziee-ai/cryptomcp. Add exactly one folder, registry/<id>/, with exactly these four files and nothing else:
  manifest.json  The manifest, byte for byte the same as in my repository at that commit.
  samples.json   One sample intent for every action in the manifest.
  icon.svg       A plain SVG: shapes, paths and gradients only. No scripts, no links, no images. At most 8 KB.
  entry.json     This shape:
{
  "repo": "https://github.com/<owner>/<repository>",
  "commit": "<the 40 character commit hash from step 4>",
  "tagline": "One line, at most 80 characters",
  "links": { "docs": "https://...", "x": "https://..." },
  "maintainers": ["my-github-login"]
}
"repo" must be public. "maintainers" are the GitHub logins allowed to change this entry later. The pull request's author must be one of them.

STEP 6. Open the pull request.
Open it against eziee-ai/cryptomcp from my GitHub account. Change nothing outside registry/<id>/.

STEP 7. Watch the automatic check.
A GitHub Action reports on the pull request. Read its report. Fix what it names and push again. Tell me when it is green. After that a person reviews it, and then the protocol is listed.

If anything here is unclear, read https://cryptomcp.io/submit and the template's docs/guideline.md. Do not guess.
`;
