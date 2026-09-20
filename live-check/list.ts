/** Prints the live check's job matrix as GitHub Actions outputs: one { id, key } per protocol on main. */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, secretKeyFor } from "../lib/registry";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const protocols = loadRegistry(join(ROOT, "registry")).map((entry) => ({ id: entry.id, key: secretKeyFor(entry.id) }));
console.log(`matrix=${JSON.stringify(protocols)}`);
console.log(`empty=${protocols.length === 0}`);
