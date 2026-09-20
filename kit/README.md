# kit: eziee's own checks, vendored

These files are copied **unchanged** from the eziee app, `packages/protocols/src/`, at commit
`58258ba49996c42f5e5522ed6519b3b6dce96a0c` (2026-09-20). They are the code that decides, at run time, whether what
your server returns ever reaches a wallet. Running them here means you find out before a reviewer does.

| File | What it is |
|---|---|
| `manifest/schema.ts` | `parseManifest`: the strict manifest schema and its cross-field rules |
| `manifest/decode.ts` | `decodeAction`, `decodeApproval`: calldata to meaning, from the manifest alone. The wallet runs this before it signs |
| `mcp/adapter.ts` | `acceptBuild`: a `build` answer accepted or refused as a whole. `actionProblem`: whether an action is offered at all |
| `mcp/caller.ts` | eziee's MCP client: stateless, HTTPS only, no redirects, 64 KB cap, timeouts |
| `conform/checks.ts`, `conform/proxy.ts`, `conform/args.ts` | The conformance checks behind `pnpm conform` |
| `errors.ts`, `text.ts`, `types.ts`, `simulate.ts` | What the files above import |

**Do not edit anything in this folder.** A change here makes your local run disagree with eziee's, and eziee's is the
one that counts. If a rule looks wrong, or your protocol cannot be expressed in the decoder's vocabulary, open an
issue on this repository. When eziee changes these files, this folder is updated and the commit above moves.

Only `viem` and `zod` are needed to run them. The zod version is pinned in `package.json` because the schema uses
the zod 3 API.
