import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * `chains.json`: the chains a submission may name, and the ONLY RPC endpoints the validator and the live check ever
 * call. It is owned by maintainers. A pull request cannot add to it and be judged by it in the same breath, because
 * the validator reads it from `main`.
 */
const httpsUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}, "must be an https: URL without credentials");

const chainsSchema = z.record(z.string().regex(/^[1-9][0-9]*$/, "chain ids are decimal strings"), z.object({ name: z.string().min(1).max(40), rpc: httpsUrl, explorer: httpsUrl }).strict());

export type Chains = z.infer<typeof chainsSchema>;

export function parseChains(input: unknown): Chains {
  const result = chainsSchema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(`chains.json: ${result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
}

export const loadChains = (path: string | URL): Chains => parseChains(JSON.parse(readFileSync(path, "utf8")));
