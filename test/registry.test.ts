import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRegistry, secretKeyFor } from "../lib/registry";

const FIXTURES = fileURLToPath(new URL("./fixtures/registry", import.meta.url));
const copy = () => {
  const root = mkdtempSync(join(tmpdir(), "registry-"));
  cpSync(FIXTURES, root, { recursive: true });
  return root;
};

describe("loadRegistry", () => {
  it("reads and parses every protocol", () => {
    const [entry] = loadRegistry(FIXTURES);
    expect(entry).toMatchObject({ id: "yourprotocol", manifest: { name: "Your Protocol" }, entry: { maintainers: ["alice"] } });
    expect(Object.keys(entry!.samples)).toEqual(["swap", "closePosition"]);
  });

  it("is empty for a registry that does not exist yet", () => {
    expect(loadRegistry(join(tmpdir(), "no-such-registry"))).toEqual([]);
  });

  it("names the folder when something in it is wrong", () => {
    const renamed = copy();
    cpSync(join(renamed, "yourprotocol"), join(renamed, "other"), { recursive: true });
    expect(() => loadRegistry(renamed)).toThrow(/registry\/other: the manifest's id is "yourprotocol"/);
    const badIcon = copy();
    writeFileSync(join(badIcon, "yourprotocol", "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(() => loadRegistry(badIcon)).toThrow(/registry\/yourprotocol: icon\.svg/);
  });
});

describe("secretKeyFor", () => {
  it("upper-cases and turns hyphens into underscores", () => {
    expect(secretKeyFor("your-protocol-2")).toBe("YOUR_PROTOCOL_2");
  });
});
