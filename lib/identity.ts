import { z } from "zod";
import type { Finding } from "../kit/conform/checks";
import type { Manifest } from "../kit/manifest";
import type { Entry } from "./entry";

/**
 * Who is this, really? Three checks that tie a submission's name, its website, its server and its repository to
 * one another, so that calling yourself "Uniswap" takes more than typing it.
 *
 * None of them connects to a host a submission names. The domain proof is a DNS lookup through the runner's own
 * resolver: the answer is text, compared with a string, and nothing is ever fetched from the domain itself.
 */
export type ResolveTxt = (name: string) => Promise<string[]>;

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const MAX_URL = 200;

/** Why a URL is not a plain one, or null. Plain: https, no user or password, a DNS name that is not an IDN, not overlong. */
export function urlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "is not a URL";
  }
  if (value.length > MAX_URL) return `is longer than ${MAX_URL} characters`;
  if (url.protocol !== "https:") return "must be https:";
  // `https://uniswap.org@evil.example/` is on evil.example and reads as uniswap.org. The part before the @ is never needed here.
  if (url.username !== "" || url.password !== "") return "must not carry a user name or password";
  const host = url.hostname.toLowerCase();
  if (!HOST.test(host)) return "must be on a DNS name, not an IP address or a bare host";
  // An IDN is resolved as punycode and displayed as whatever it imitates. No protocol needs one for its homepage.
  if (host.split(".").some((label) => label.startsWith("xn--"))) return "must not be on an internationalised (xn--) domain";
  return null;
}

/**
 * The manifest schema, which this repository may not edit, takes any URL a parser accepts for `homepage` and for a
 * contract's `source`: any scheme, with credentials, on any host. Both are shown to people, so both are held to
 * more here. Used by the validator AND by everything that reads the merged registry, so nothing renders one unchecked.
 */
export function manifestUrlProblems(manifest: Manifest): string[] {
  const problems: string[] = [];
  const check = (where: string, value: string) => {
    const problem = urlProblem(value);
    if (problem) problems.push(`${where} ${problem}`);
  };
  check("homepage", manifest.homepage);
  if (manifest.mcp) check("mcp.url", manifest.mcp.url);
  for (const [chainId, contracts] of Object.entries(manifest.contracts)) for (const [key, contract] of Object.entries(contracts)) check(`contracts.${chainId}.${key}.source`, contract.source);
  // The name is shown to people beside a state badge. Printable ASCII only: a Cyrillic "a" is a different protocol.
  if (!Array.from(manifest.name).every((ch) => ch.codePointAt(0)! >= 0x20 && ch.codePointAt(0)! <= 0x7e)) problems.push("name must be printable ASCII");
  return problems;
}
export const PROOF_LABEL = "_cryptomcp";
export const PROOF_PREFIX = "cryptomcp-repo=";

/** The homepage's host as a plain DNS name without a leading `www.`, or null for an IP address, `localhost` and the like. */
export function siteHost(manifest: Manifest): string | null {
  if (urlProblem(manifest.homepage) !== null) return null;
  const host = new URL(manifest.homepage).hostname.toLowerCase();
  // `www.` is dropped only when a real name is left: `www.com` is not "com", which every .com host would be under.
  const bare = host.replace(/^www\./, "");
  return HOST.test(bare) ? bare : host;
}

const pass = (check: string, detail = ""): Finding => ({ check, status: "pass", detail });
const fail = (check: string, detail: string): Finding => ({ check, status: "fail", detail });

/** The server must live on the website's own domain. Both are in the manifest; nothing is looked up. */
export function serverHostFinding(manifest: Manifest): Finding {
  const check = "the server is on the homepage's domain";
  const site = siteHost(manifest);
  if (!site) return fail(check, "homepage is not a plain https: URL on a DNS name");
  if (!manifest.mcp) return fail(check, "the manifest names no server");
  const server = new URL(manifest.mcp.url).hostname.toLowerCase();
  return server === site || server.endsWith(`.${site}`) ? pass(check, `${server} is under ${site}`) : fail(check, `mcp.url is on ${server}, which is not ${site} or a subdomain of it. Serve it from your own domain, or set homepage to the domain you serve it from`);
}

/**
 * Whoever controls the homepage's DNS says which repository speaks for it: a TXT record at
 * `_cryptomcp.<homepage host>` holding `cryptomcp-repo=<owner>/<repository>`.
 */
export async function domainProofFinding(manifest: Manifest, entry: Entry, resolveTxt: ResolveTxt): Promise<Finding> {
  const check = "the homepage's domain names this repository";
  const site = siteHost(manifest);
  if (!site) return fail(check, "homepage is not a plain https: URL on a DNS name");
  const name = `${PROOF_LABEL}.${site}`;
  const wanted = `${PROOF_PREFIX}${entry.repo.slice("https://github.com/".length)}`.toLowerCase();
  let records: string[];
  try {
    records = await resolveTxt(name);
  } catch {
    records = [];
  }
  if (records.some((record) => record.trim().toLowerCase() === wanted)) return pass(check, name);
  return fail(check, `add a DNS TXT record at ${name} with the value ${wanted} and push again. It shows that whoever controls ${site} chose this repository`);
}

const reservedSchema = z.array(z.string().regex(/^[a-z0-9]+$/)).max(500);
export const parseReserved = (input: unknown): string[] => reservedSchema.parse(input);

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A well-known name, as the id or at the start of the display name, is not available to a first-come submission. */
export function reservedNameFinding(manifest: Manifest, reserved: string[]): Finding {
  const check = "the name is not a reserved one";
  const id = squash(manifest.id);
  const name = squash(manifest.name);
  // Short words match whole words only ("sky" must not block "Skyline"). Longer ones match anywhere: "Uniswap V4", "The
  // Uniswap Protocol". The name is ASCII by the time it gets here (manifestUrlProblems), so nothing was deleted from
  // it on the way to this comparison: a look-alike letter is refused there, not squashed out of a match here.
  // A short word also matches as one of the name's or the id's own words: "Sky Protocol", "aave-markets".
  const words = new Set([...manifest.name.toLowerCase().split(/[^a-z0-9]+/), ...manifest.id.split("-")].filter(Boolean));
  const hit = reserved.find((word) => id === word || name === word || words.has(word) || (word.length >= 5 && (id.includes(word) || name.includes(word))));
  return hit === undefined ? pass(check) : fail(check, `"${hit}" is reserved, so that nobody lists a well-known protocol by getting here first. If this is that protocol, say so in the pull request; a maintainer who has confirmed it releases the name in a pull request of their own`);
}
