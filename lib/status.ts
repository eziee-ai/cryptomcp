import { z } from "zod";

/**
 * `status.json` on the `status` branch: what the scheduled live check found (spec §7). The site reads it at build.
 *
 *   conformant   the live server passed eziee's conformance at `checkedAt`
 *   failing      it did not; `failures` says which checks
 *   unchecked    no key is stored for it yet, so nothing was asked of its server. The site calls this "Listed".
 */
const protocolStatus = z
  .object({
    state: z.enum(["conformant", "failing", "unchecked"]),
    checkedAt: z.string().datetime(),
    /** When the current `state` began. */
    since: z.string().datetime(),
    /** Whether `entry.repo` was created from protocol-mcp-template, as GitHub records it. null when that could not be read. */
    fromTemplate: z.boolean().nullable(),
    summary: z.object({ pass: z.number().int().min(0), fail: z.number().int().min(0), notRun: z.number().int().min(0) }).strict(),
    failures: z.array(z.object({ check: z.string().max(120), detail: z.string().max(200) }).strict()).max(50),
  })
  .strict();

export const statusSchema = z.object({ generatedAt: z.string().datetime(), protocols: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/), protocolStatus) }).strict();

export type ProtocolStatus = z.infer<typeof protocolStatus>;
export type Status = z.infer<typeof statusSchema>;
export type CheckResult = Omit<ProtocolStatus, "since">;

export const EMPTY_STATUS = (now: string): Status => ({ generatedAt: now, protocols: {} });

export const parseStatus = (input: unknown): Status => statusSchema.parse(input);

/**
 * This run's results merged over the last status. `since` carries over while the state is unchanged, so the site
 * can say "failing since" truthfully. A protocol that is no longer in the registry is dropped.
 */
export function assembleStatus(previous: Status | null, results: Record<string, CheckResult>, now: string): Status {
  const protocols: Status["protocols"] = {};
  for (const [id, result] of Object.entries(results).sort(([a], [b]) => a.localeCompare(b))) {
    const before = previous?.protocols[id];
    protocols[id] = { ...result, since: before && before.state === result.state ? before.since : result.checkedAt };
  }
  return statusSchema.parse({ generatedAt: now, protocols });
}
