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
export const PROOF_LABEL = "_cryptomcp";
export const PROOF_PREFIX = "cryptomcp-repo=";

/** The homepage's host as a plain DNS name without a leading `www.`, or null for an IP address, `localhost` and the like. */
export function siteHost(manifest: Manifest): string | null {
  const host = new URL(manifest.homepage).hostname.toLowerCase().replace(/^www\./, "");
  return HOST.test(host) ? host : null;
}

const pass = (check: string, detail = ""): Finding => ({ check, status: "pass", detail });
const fail = (check: string, detail: string): Finding => ({ check, status: "fail", detail });

/** The server must live on the website's own domain. Both are in the manifest; nothing is looked up. */
export function serverHostFinding(manifest: Manifest): Finding {
  const check = "the server is on the homepage's domain";
  const site = siteHost(manifest);
  if (!site) return fail(check, "homepage must be an https: URL on a DNS name, not an IP address");
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
  if (!site) return fail(check, "homepage must be an https: URL on a DNS name, not an IP address");
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
  // Short words match whole ("sky" must not block "Skyline"); longer ones also match as a prefix ("Uniswap V4").
  const hit = reserved.find((word) => id === word || name === word || (word.length >= 5 && (id.startsWith(word) || name.startsWith(word))));
  return hit === undefined ? pass(check) : fail(check, `"${hit}" is reserved, so that nobody lists a well-known protocol by getting here first. If this is that protocol, say so in the pull request; a maintainer who has confirmed it releases the name in a pull request of their own`);
}
