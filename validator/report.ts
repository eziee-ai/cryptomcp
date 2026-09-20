import type { Finding } from "../kit/conform/checks";
import { clean } from "../kit/text";

/**
 * The comment the validator leaves on a pull request (spec §5.3).
 *
 * Every check name and detail may quote a submission: a token's symbol, a manifest's complaint, a file name. So all
 * of it goes through the kit's `clean`, which removes markup, link syntax and invisible characters, and then into a
 * code span, where a mention pings nobody and emphasis is just asterisks.
 */
export const MARKER = "<!-- cryptomcp-validate -->";

const LABEL: Record<Finding["status"], string> = { pass: "pass", fail: "**FAIL**", "not-run": "not run", note: "note" };

/** Text from anywhere, as one inert code span. Backticks are gone after `clean`, so the span cannot be closed from inside. */
function code(value: string, max: number): string {
  const inert = clean(value, max).replace(/\|/g, "/");
  return inert === "" ? "" : `\`${inert}\``;
}

export function renderReport(findings: Finding[], meta: { id?: string; sha: string }): string {
  const count = (status: Finding["status"]) => findings.filter((finding) => finding.status === status && !finding.manual).length;
  const automatic = findings.filter((finding) => !finding.manual);
  const manual = findings.filter((finding) => finding.manual);
  const failed = count("fail") > 0 || count("not-run") > 0;

  const lines = [MARKER, meta.id ? `### Registry validation: ${code(meta.id, 40)}` : "### Registry validation", ""];
  if (!meta.id) lines.push("This pull request is not judged as a registry submission.", "");
  lines.push(failed ? "**Not ready.** Every FAIL below has to be fixed before a reviewer looks at this." : "**The automatic checks pass.** That is necessary, not sufficient: a reviewer still checks by hand what is listed at the end.", "");

  lines.push("| | Check | Detail |", "|---|---|---|");
  for (const finding of automatic) lines.push(`| ${LABEL[finding.status]} | ${code(finding.check, 120)} | ${code(finding.detail, 400)} |`);
  lines.push("", `${count("pass")} passed, ${count("fail")} failed, ${count("not-run")} not run, ${count("note")} note(s). Checked at ${code(meta.sha.slice(0, 12), 12)}.`);

  if (manual.length > 0) {
    lines.push("", "#### A reviewer still has to", "");
    for (const finding of manual) lines.push(`- [ ] not run: ${code(finding.check, 120)} ${code(finding.detail, 300)}`);
  }
  lines.push("", "<sub>This check runs from `main` and reads the pull request's files as data. It never runs anything from the pull request, so nothing in it can change this result.</sub>");
  return lines.join("\n");
}
