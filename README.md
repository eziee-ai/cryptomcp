<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eziee-ai/.github/main/profile/eziee-wordmark-dark.svg">
  <img alt="eziee" src="https://raw.githubusercontent.com/eziee-ai/.github/main/profile/eziee-wordmark-light.svg" height="56">
</picture>

# cryptomcp

The registry of protocols you can use from [eziee](https://github.com/eziee-ai), the AI desk for DeFi, and the source
of [cryptomcp.io](https://cryptomcp.io).

A protocol joins eziee by hosting an MCP server and publishing a manifest: its contracts, tokens and actions, and how
to decode each action's calldata. The manifest is what a wallet believes. This repository is where manifests are
submitted, checked, reviewed and kept, in the open.

## Add your protocol

1. Build your server from [protocol-mcp-template](https://github.com/eziee-ai/protocol-mcp-template) and get
   `pnpm conform --strict` to exit 0 against it.
2. Show that your domain stands behind your repository: add a DNS TXT record at `_cryptomcp.<your homepage's domain>`
   with the value `cryptomcp-repo=<owner>/<repository>`, and serve your MCP server from that domain or a subdomain of
   it. This is what stops anyone else from listing a protocol under your name.
3. Open a pull request here that adds one folder and touches nothing else:

   ```
   registry/<id>/manifest.json   the manifest, byte for byte the one in your own repository
   registry/<id>/samples.json    one sample intent per action
   registry/<id>/icon.svg        a plain SVG, at most 8 KB
   registry/<id>/entry.json      your repository, the commit, a tagline, who may update the entry
   ```

   ```json
   {
     "repo": "https://github.com/yourorg/yourprotocol-mcp",
     "commit": "<the full 40-character commit SHA>",
     "tagline": "One line, at most 80 characters",
     "links": { "docs": "https://docs.yourprotocol.example" },
     "maintainers": ["your-github-login"]
   }
   ```

4. The validator comments on the pull request within a minute or two. Fix every FAIL.
5. A maintainer reviews what no program can: each function signature against verified source, each spending action
   simulated on a fork, who can upgrade each proxy. See the pull request template.
6. After the merge you give a maintainer your server's key privately. From then on a scheduled check runs eziee's
   conformance against your live server every day.

[CONTRIBUTING.md](CONTRIBUTING.md) has the details, including how to add a chain.

## What a listing means

| On cryptomcp.io | It means |
|---|---|
| **Listed** | The manifest was validated, reviewed and merged. Nothing is claimed about the live server. |
| **Conformant**, with a date | On that date the live server passed the same checks eziee enforces at run time: every sample build decoded, from the manifest alone, to the action that was asked for, with exact approvals and the signer as recipient. |
| **Failing**, with a date | It stopped passing on that date. The page says which check. |

A listing is not an audit and not an endorsement. Being listed here does not change what eziee's wallet will sign:
the app takes manifests from this repository at a commit it pins, release by release.

## How a pull request is judged

`.github/workflows/validate.yml` runs on `pull_request_target`, from `main`. It never checks out the pull request. It
reads the changed files through the GitHub API as bytes and only parses them, so a pull request cannot change how it
is judged and has nothing to run. It holds no secret. The only hosts it connects to are `api.github.com` and the RPC
endpoints in [`chains.json`](chains.json). It asks the runner's DNS resolver for one TXT record on your homepage's
domain. No URL from a submission is ever fetched, and no connection is ever opened to a host a submission names.

It checks that the pull request touches one `registry/<id>/` and nothing else; that the author may change that
entry, judged by the maintainers already on `main`; eziee's own strict manifest parser; that every action has a
sample; that the name is not reserved for a well-known protocol ([`reserved.json`](reserved.json)); that the server
is on the homepage's domain and that domain's DNS names your repository; that every contract has code and the proxy type it declares, and every token answers `symbol()` and
`decimals()` as declared; that the icon is inert; and that your repository holds this exact manifest at the commit
you named.

A green check means those things and no more. It cannot tell a contract you reviewed from another that merely has
code, so an approval is for one commit: a push after it dismisses it, and the last push must itself be approved.

The checking code in [`kit/`](kit/) is eziee's own, copied unchanged from the template at the commit in
[`kit.lock`](kit.lock), which must be a commit on the template's `main`. `pnpm sync-kit --check` fails if it differs
by a byte. That check runs in ordinary CI, from the pull request's own code, so a pull request could switch it off:
what protects `kit/` is that it has code owners, and that such a pull request is never a submission.

## Security

See [SECURITY.md](SECURITY.md). The design is in [docs/specs](docs/specs/).
