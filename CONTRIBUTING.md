# Contributing

## Submitting or updating a protocol

Touch only `registry/<id>/`. A pull request that touches an entry and anything else is refused whole, so that an
entry is always judged by the validator alone.

- `<id>` is lowercase `a-z`, `0-9` and `-`, at most 32 characters, equal to `id` in your manifest, and permanent.
- `manifest.json` must parse with eziee's `parseManifest` and must name your server in `mcp.url` (`https:`).
  It must be byte for byte the file at `registry/<id>/manifest.json` in your own public repository at the commit you
  put in `entry.json`. Tag that commit.
- `homepage` must be on a DNS name you control, `mcp.url` on that name or a subdomain of it, and a TXT record at
  `_cryptomcp.<that name>` must hold `cryptomcp-repo=<owner>/<repository>`. Check it with
  `dig +short TXT _cryptomcp.yourprotocol.example`. Keep it: the daily check asks again, and a protocol whose domain
  stops naming its repository is shown as Failing.
- A first submission may not use a name in [`reserved.json`](reserved.json), as its id or at the start of its
  display name. If you are that protocol, say so in the pull request; a maintainer who has confirmed it releases the
  name in a pull request of their own.
- Every chain in the manifest must already be in [`chains.json`](chains.json).
- `samples.json` has one intent per action. An action without a sample can never be shown to conform.
- `icon.svg`: shapes, paths and gradients only. No script, no `style` element or attribute, no `use`, no `image`, no
  links, no references outside the file, no backslashes, no DOCTYPE, at most 8 KB.
- The daily check's results are public, including what your server said when a check failed. Do not put a secret in
  a tool's error message.
- Only the GitHub logins in an entry's `maintainers` **on `main`** may change it later. To hand an entry over, a
  current maintainer adds the new login.

To delist, ask a maintainer. A maintainer removes the whole folder in one pull request.

## Adding a chain

Maintainers only, in a pull request of its own, because the RPC endpoint you add is one this repository will call
from its workflows. Add `"<chainId>": { "name", "rpc", "explorer" }` to `chains.json`, both URLs `https:` and without
credentials, and say in the pull request where the RPC URL is published by the chain itself. Check it answers as that
chain:

```bash
cast chain-id --rpc-url <rpc>
```

The chains here today, and where each endpoint comes from:

| Chain | RPC | Source |
|---|---|---|
| 5042002 Arc Testnet | `https://rpc.testnet.arc.network` | eziee's deployments for Iter, vendored from `iter-monorepo` |
| 11155931 RISE Testnet | `https://testnet.riselabs.xyz` | eziee's deployments for Iter, vendored from `iter-monorepo` |

## Working on the code

```bash
pnpm install
pnpm typecheck && pnpm test
pnpm --filter site test && pnpm --filter site build
pnpm sync-kit --check
```

Node 22, pnpm 10. `kit/` is never edited here: `pnpm sync-kit <commit>` replaces it from
[protocol-mcp-template](https://github.com/eziee-ai/protocol-mcp-template) and records the commit.

`validate.yml` runs on `pull_request_target`. Read the comment at the top of it and [SECURITY.md](SECURITY.md) before
changing it, `validator/` or `lib/svg.ts`. `test/workflows.test.ts` pins the properties that keep it safe.
