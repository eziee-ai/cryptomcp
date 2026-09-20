/**
 * The one place the site decides whether a string taken from a submission (a homepage, a `repo`, an `entry.links`
 * value, a maintainer login) may become a link. Returns the value unchanged when it may, `null` otherwise — callers
 * render `null` as plain text.
 *
 * `new URL()` tolerates and strips leading/trailing ASCII whitespace and C0 controls per the WHATWG URL spec, which
 * would otherwise let " https://x" through; this rejects the raw string first so that never matters.
 */
import { urlProblem } from "../../../lib/identity";

export function safeHref(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value !== value.trim()) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  // The same rule the validator holds a manifest's URLs to: https, NO user name or password (so that
  // `https://uniswap.org@evil.example/` is never a link whose text reads "uniswap.org"), a DNS name, not an IDN.
  return urlProblem(value) === null ? value : null;
}
