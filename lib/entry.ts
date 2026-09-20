import { z } from "zod";

/**
 * `entry.json`: what a listing needs that the manifest does not carry (spec §3). Strict, like the manifest: an
 * unknown key is an error, because a key nobody reads is a key nobody reviewed.
 */

// Controls, soft hyphen, zero-width and direction-changing characters, as code point ranges so that this file
// never has to contain one. A tagline is shown to people; none of these belong in it.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x115f, 0x1160],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
];
const hasInvisible = (value: string) => Array.from(value).some((ch) => INVISIBLE_RANGES.some(([low, high]) => ch.codePointAt(0)! >= low && ch.codePointAt(0)! <= high));
const LINK_KEYS = ["docs", "app", "x", "discord", "github"] as const;

const httpsUrl = z.string().max(200).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}, "must be an https: URL without credentials");

const repo = z
  .string()
  .regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must be https://github.com/<owner>/<repository>")
  .refine((value) => value.split("/").slice(3).every((part) => part !== "." && part !== "..") && !value.endsWith(".git"), "must name a repository, without .git");

const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "must be a GitHub login");

export const entrySchema = z
  .object({
    repo,
    commit: z.string().regex(/^[0-9a-f]{40}$/, "must be a full lower-case 40-character commit SHA"),
    tagline: z.string().min(1).max(80).refine((value) => !hasInvisible(value), "must not contain control or invisible characters"),
    links: z.object(Object.fromEntries(LINK_KEYS.map((key) => [key, httpsUrl.optional()])) as Record<(typeof LINK_KEYS)[number], z.ZodOptional<typeof httpsUrl>>).strict().optional(),
    maintainers: z.array(login).min(1).max(5).refine((logins) => new Set(logins.map((entry) => entry.toLowerCase())).size === logins.length, "lists a login twice"),
  })
  .strict();

export type Entry = z.infer<typeof entrySchema>;

export const samplesSchema = z.record(
  z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "is not an action name"),
  z.object({ chainId: z.number().int().positive(), intent: z.record(z.unknown()) }).strict(),
);

export type Samples = z.infer<typeof samplesSchema>;

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(`${what}: ${result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
}

/** Throws one Error naming every problem found. */
export const parseEntry = (input: unknown): Entry => parseWith(entrySchema, input, "entry.json");
export const parseSamples = (input: unknown): Samples => parseWith(samplesSchema, input, "samples.json");
