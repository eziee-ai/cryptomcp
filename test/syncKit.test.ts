import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffTrees } from "../scripts/sync-kit";

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kit-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

describe("diffTrees", () => {
  it("finds nothing between identical trees", () => {
    expect(diffTrees(tree({ "a.ts": "1", "m/b.ts": "2" }), tree({ "a.ts": "1", "m/b.ts": "2" }))).toEqual([]);
  });

  it("names a changed byte, an added file and a removed file", () => {
    const problems = diffTrees(tree({ "a.ts": "1", "m/b.ts": "2", "gone.ts": "3" }), tree({ "a.ts": "1 ", "m/b.ts": "2", "new.ts": "4" }));
    expect(problems).toEqual(["a.ts differs", "gone.ts is missing", "new.ts is not in the template's kit"]);
  });
});
