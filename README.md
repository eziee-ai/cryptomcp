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
2. Open a pull request here that adds one folder and touches nothing else:

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

3. The validator comments on the pull request within a minute or two. Fix every FAIL.
4. A maintainer reviews what no program can: each function signature against verified source, each spending action
   simulated on a fork, who can upgrade each proxy. See the pull request template.
5. After the merge you give a maintainer your server's key privately. From then on a scheduled check runs eziee's
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
is judged and has nothing to run. It holds no secret. The only hosts it contacts are `api.github.com` and the RPC
endpoints in [`chains.json`](chains.json); no URL from a submission is ever fetched.

It checks that the pull request touches one `registry/<id>/` and nothing else; that the author may change that
entry, judged by the maintainers already on `main`; eziee's own strict manifest parser; that every action has a
sample; that every contract has code and the proxy type it declares, and every token answers `symbol()` and
`decimals()` as declared; that the icon is inert; and that your repository holds this exact manifest at the commit
you named.

The checking code in [`kit/`](kit/) is eziee's own, copied unchanged from the template at the commit in
[`kit.lock`](kit.lock). CI fails if it differs by a byte.

## Security

See [SECURITY.md](SECURITY.md). The design is in [docs/specs](docs/specs/).
