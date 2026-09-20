# Security

Report a vulnerability privately: **Security → Report a vulnerability** on this repository. Please do not open an
issue or a pull request for it.

In scope, and the things most worth breaking:

- **The validator's trust model.** `.github/workflows/validate.yml` runs on `pull_request_target`. It is only safe
  while nothing from a pull request is checked out, installed, imported or executed. Any way to make it run or
  render submitted content, reach a secret, contact a host a submission chose, or report a result a submission
  controls, is a vulnerability.
- **The path guard.** Any pull request that touches something outside one `registry/<id>/` and is still judged as a
  submission, or any way to change an entry you do not maintain.
- **The icon check.** Any SVG that passes `lib/svg.ts` and is not inert.
- **The report.** Any submitted text that leaves its code span in the pull request comment.
- **The site.** Any submitted text that reaches a page as markup, or any page that ships script.
- **The live check.** Any way to have a protocol's server key sent anywhere but that protocol's reviewed `mcp.url`.

A listing here is not an audit of the protocol. Problems in a listed protocol's contracts go to that protocol.
