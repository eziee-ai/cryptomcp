import { ID } from "../lib/registry";

/**
 * What kind of pull request is this, judged from the paths it touches alone? (spec §5.2)
 *
 * This runs before a single byte of the pull request is read. A submission may touch the four files of ONE entry
 * and nothing else, so everything the validator goes on to fetch has a name it chose itself.
 */
export interface ChangedFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export type Guard = { kind: "submission"; id: string } | { kind: "maintainer-change" } | { kind: "refused"; problems: string[] };

export const ENTRY_FILES = ["manifest.json", "samples.json", "icon.svg", "entry.json"] as const;
export const MAX_FILES = ENTRY_FILES.length;

// GitHub reserves the `[bot]` suffix for apps, so no person can hold this login.
const DEPENDABOT = "dependabot[bot]";

const inRegistry = (path: string) => path === "registry" || path.startsWith("registry/");

/**
 * `canWrite` is the author's REAL permission on this repository, asked of GitHub (write, maintain or admin). It is
 * not the event's `author_association`: on an organisation's repository GitHub calls even the organisation's owner
 * a MEMBER, and calls a member with no access to this repository a MEMBER too. The label cannot tell them apart.
 */
export function guardPaths(files: ChangedFile[], author: { login: string; canWrite: boolean }): Guard {
  const refuse = (...problems: string[]): Guard => ({ kind: "refused", problems });
  if (files.length === 0) return refuse("the pull request changes no files");

  const maintainer = author.canWrite;
  const paths = files.flatMap((file) => [file.filename, ...(file.previous_filename === undefined ? [] : [file.previous_filename])]);

  // Refused outright, whoever sends them: a path that is not what it looks like.
  const strange = paths.filter((path) => path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part === ""));
  if (strange.length > 0) return refuse(...strange.map((path) => `"${path}" is not a plain relative path`));

  const touchesRegistry = paths.filter(inRegistry);
  if (touchesRegistry.length === 0) {
    if (maintainer || author.login === DEPENDABOT) return { kind: "maintainer-change" };
    return refuse("this pull request touches nothing under registry/. Outside contributors may add or update one entry under registry/<id>/ and nothing else; for anything else, open an issue");
  }
  if (touchesRegistry.length !== paths.length) return refuse("a pull request that touches an entry under registry/ may touch nothing else, so that it is judged by the validator alone");

  if (files.some((file) => file.status === "renamed" || file.status === "copied" || file.previous_filename !== undefined)) return refuse("entries are not renamed or copied; add the new one and remove the old one separately");

  const problems: string[] = [];
  const ids = new Set<string>();
  for (const { filename } of files) {
    const [, id, name, ...rest] = filename.split("/");
    if (id === undefined || name === undefined || rest.length > 0) problems.push(`"${filename}" is not registry/<id>/<file>`);
    else if (!ID.test(id)) problems.push(`"${id}" is not a valid id (lowercase a-z, 0-9 and -, at most 32 characters)`);
    else if (!(ENTRY_FILES as readonly string[]).includes(name)) problems.push(`"${filename}": an entry holds only ${ENTRY_FILES.join(", ")}`);
    else ids.add(id);
  }
  if (problems.length > 0) return refuse(...problems);
  if (ids.size !== 1) return refuse(`one pull request is one entry; this one touches ${[...ids].sort().join(", ")}`);
  if (files.length > MAX_FILES || new Set(files.map((file) => file.filename)).size !== files.length) return refuse(`an entry is at most ${MAX_FILES} files, each listed once`);

  const removed = files.filter((file) => file.status === "removed");
  if (removed.length > 0) {
    if (maintainer && removed.length === files.length) return { kind: "maintainer-change" };
    return refuse("files of an entry are not removed by a submission; only a maintainer delists, and only a whole entry at once");
  }
  if (files.some((file) => file.status !== "added" && file.status !== "modified")) return refuse("files of an entry may only be added or modified");

  return { kind: "submission", id: [...ids][0]! };
}
