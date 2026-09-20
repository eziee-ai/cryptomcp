import { describe, expect, it } from "vitest";
import { guardPaths, type ChangedFile } from "../validator/pathGuard";

const added = (...names: string[]): ChangedFile[] => names.map((filename) => ({ filename, status: "added" }));
const FOUR = ["manifest.json", "samples.json", "icon.svg", "entry.json"].map((name) => `registry/acme/${name}`);
const outsider = { login: "mallory", canWrite: false };
const owner = { login: "hskang9", canWrite: true };

describe("guardPaths", () => {
  it("accepts a submission: the four files of one entry", () => {
    expect(guardPaths(added(...FOUR), outsider)).toEqual({ kind: "submission", id: "acme" });
  });

  it("accepts an update that touches only some of them", () => {
    expect(guardPaths([{ filename: "registry/acme/icon.svg", status: "modified" }], outsider)).toEqual({ kind: "submission", id: "acme" });
  });

  it.each([
    ["a file outside the registry alongside an entry", added(...FOUR.slice(0, 3), "README.md")],
    ["a workflow alongside an entry", added("registry/acme/manifest.json", ".github/workflows/validate.yml")],
    ["two entries at once", added("registry/acme/manifest.json", "registry/other/manifest.json")],
    ["a file name that is not one of the four", added("registry/acme/extra.json")],
    ["a nested folder", added("registry/acme/b/manifest.json")],
    ["a file directly under registry/", added("registry/manifest.json")],
    ["an upper-case id", added("registry/Acme/manifest.json")],
    ["an id that is too long", added(`registry/${"a".repeat(33)}/manifest.json`)],
    ["a parent-directory segment", added("registry/../.github/workflows/x.yml")],
    ["a parent-directory segment inside the entry", added("registry/acme/../other/manifest.json")],
    ["an absolute path", added("/registry/acme/manifest.json")],
    ["a backslash", added("registry\\acme\\manifest.json")],
    ["a name that only starts with registry", added("registryx/acme/manifest.json", "registry/acme/manifest.json")],
  ])("refuses %s, whoever sends it", (_name, files) => {
    expect(guardPaths(files, outsider).kind).toBe("refused");
    expect(guardPaths(files, owner).kind).toBe("refused");
  });

  it("refuses a rename, from or to an entry", () => {
    expect(guardPaths([{ filename: "registry/acme/manifest.json", status: "renamed", previous_filename: "registry/other/manifest.json" }], outsider).kind).toBe("refused");
    expect(guardPaths([{ filename: "docs/x.json", status: "renamed", previous_filename: "registry/other/manifest.json" }], owner).kind).toBe("refused");
  });

  it("refuses a removal from anyone but a maintainer, and lets a maintainer delist a whole entry", () => {
    const removed: ChangedFile[] = FOUR.map((filename) => ({ filename, status: "removed" }));
    expect(guardPaths(removed, outsider).kind).toBe("refused");
    expect(guardPaths(removed, owner)).toEqual({ kind: "maintainer-change" });
    expect(guardPaths([removed[0]!, { filename: FOUR[1]!, status: "modified" }], owner).kind).toBe("refused");
  });

  it("refuses more than four files, and an empty change set", () => {
    expect(guardPaths([...added(...FOUR), { filename: "registry/acme/manifest.json", status: "modified" }], outsider).kind).toBe("refused");
    expect(guardPaths([], outsider).kind).toBe("refused");
  });

  describe("a change that touches no entry", () => {
    const workflow = added(".github/workflows/validate.yml", "validator/main.ts");

    it("is refused from anyone who cannot write to this repository", () => {
      expect(guardPaths(workflow, { login: "mallory", canWrite: false }).kind).toBe("refused");
    });

    it("is left to code owners when it comes from someone who can write, or from Dependabot", () => {
      expect(guardPaths(workflow, { login: "hskang9", canWrite: true })).toEqual({ kind: "maintainer-change" });
      expect(guardPaths(added("package.json", "pnpm-lock.yaml"), { login: "dependabot[bot]", canWrite: false })).toEqual({ kind: "maintainer-change" });
    });

    it("does not take a login that merely resembles Dependabot", () => {
      expect(guardPaths(workflow, { login: "dependabot", canWrite: false }).kind).toBe("refused");
    });
  });
});
