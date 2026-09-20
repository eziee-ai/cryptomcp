<!-- Adding or updating a protocol? Touch only registry/<id>/ and keep this text. For anything else, delete it. -->

## Submission

- Protocol:
- Repository, at the commit in `entry.json`:
- Verified source of each contract, on its explorer:

I have run `pnpm conform --strict` from the template against my deployed server and it exits 0.

## For the reviewer

The validator's report is necessary, not sufficient. Before approving:

- [ ] Each manifest `abi` matches the contract's verified source on its explorer: same function, same parameter names and types. No verified source, no listing.
- [ ] Each spending action, simulated on a forked chain: what leaves the signer equals the decoded spend, and nothing else leaves.
- [ ] Every `source` is the protocol's own, and who can upgrade each proxy is acceptable.
- [ ] Every `ignore` reason stands up, and any `bytes` argument is justified.
- [ ] The submitter speaks for this protocol.

After merging: get the server key from the protocol privately, store it as `MCP_KEY_<ID>` (id upper-cased, `-` as `_`) in the `live-check` environment, and run the live check once.
