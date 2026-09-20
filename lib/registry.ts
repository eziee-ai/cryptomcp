import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type Manifest } from "../kit/manifest";
import { parseEntry, parseSamples, type Entry, type Samples } from "./entry";
import { manifestUrlProblems } from "./identity";
import { iconProblems } from "./svg";

/** One merged protocol, read from `registry/<id>/` and parsed again: nothing downstream trusts that a merge was careful. */
export interface RegistryEntry {
  id: string;
  manifest: Manifest;
  entry: Entry;
  samples: Samples;
  /** Absolute path of the icon, which has passed `iconProblems`. */
  iconPath: string;
}

export const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** The secret that holds a protocol's server key: `MCP_KEY_` and the id upper-cased, `-` as `_`. */
export const secretKeyFor = (id: string): string => id.toUpperCase().replace(/-/g, "_");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Every protocol under `root`, sorted by id. Throws, naming the folder, when any one of them is not acceptable. */
export function loadRegistry(root: string): RegistryEntry[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort()
    .map((id) => {
      try {
        if (!ID.test(id)) throw new Error("the folder name is not a valid id");
        const dir = join(root, id);
        const manifest = parseManifest(readJson(join(dir, "manifest.json")));
        if (manifest.id !== id) throw new Error(`the manifest's id is "${manifest.id}"`);
        const urls = manifestUrlProblems(manifest);
        if (urls.length > 0) throw new Error(`manifest.json: ${urls.join("; ")}`);
        const iconPath = join(dir, "icon.svg");
        const problems = iconProblems(readFileSync(iconPath));
        if (problems.length > 0) throw new Error(`icon.svg: ${problems.join("; ")}`);
        return { id, manifest, entry: parseEntry(readJson(join(dir, "entry.json"))), samples: parseSamples(readJson(join(dir, "samples.json"))), iconPath };
      } catch (error) {
        throw new Error(`registry/${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}
