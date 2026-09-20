import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "node-html-parser";
import { describe, expect, it, beforeAll } from "vitest";
import { safeHref } from "../src/lib/safeHref";

const SITE_ROOT = path.resolve(__dirname, "..");
const ASTRO_BIN = path.join(SITE_ROOT, "node_modules/.bin/astro");
const FIXTURES = path.join(SITE_ROOT, "test/fixtures");

interface BuildResult {
  status: number | null;
  stdout: string;
  stderr: string;
  outDir: string;
}

function runBuild(opts: { registryDir: string; statusUrl: string }): BuildResult {
  const outDir = mkdtempSync(path.join(tmpdir(), "cryptomcp-site-"));
  const env = {
    ...process.env,
    CRYPTOMCP_REGISTRY_DIR: opts.registryDir,
    CRYPTOMCP_STATUS_URL: opts.statusUrl,
  };
  const result = spawnSync(ASTRO_BIN, ["build", "--outDir", outDir], { cwd: SITE_ROOT, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", outDir };
}

function allHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...allHtmlFiles(full));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** Every check spec section 8 and the task brief ask of an HTML page rendering untrusted submission content. */
function assertPageIsSafe(html: string, label: string) {
  // A hostile string like `onerror=alert(1)` or `javascript:` legitimately appears in the raw source as escaped
  // TEXT (its `<`/`>` turned into entities, or simply as inert text with no markup around it), which is exactly
  // the safe outcome — so every check below runs on the parsed DOM, not as a blanket regex over the raw source,
  // which would flag safely-escaped or safely-inert text as if it were live markup.
  const root = parse(html);

  for (const el of root.querySelectorAll("*")) {
    for (const attrName of Object.keys(el.attributes)) {
      expect(attrName.toLowerCase().startsWith("on"), `${label}: element <${el.tagName}> has attribute "${attrName}"`).toBe(false);
    }
    expect(el.attributes.style, `${label}: element <${el.tagName}> has a style attribute`).toBeUndefined();
  }

  expect(root.querySelector("script"), `${label}: a <script> element exists`).toBeNull();
  expect(root.querySelector("style"), `${label}: a <style> element exists`).toBeNull();
  expect(root.querySelector("iframe"), `${label}: an <iframe> element exists`).toBeNull();
  expect(root.querySelector("object"), `${label}: an <object> element exists`).toBeNull();
  expect(root.querySelector("embed"), `${label}: an <embed> element exists`).toBeNull();

  for (const el of root.querySelectorAll("[href], [src]")) {
    for (const attr of ["href", "src"] as const) {
      const value = el.attributes[attr];
      if (value === undefined) continue;
      expect(/^\s*(javascript|data):/i.test(value), `${label}: <${el.tagName} ${attr}="${value}">`).toBe(false);
    }
  }

  for (const a of root.querySelectorAll("a")) {
    const href = a.attributes.href;
    if (href && /^https?:\/\//i.test(href)) {
      const rel = a.attributes.rel ?? "";
      expect(rel.split(/\s+/), `${label}: external link ${href} is missing rel="noopener"`).toContain("noopener");
    }
  }
}

describe("safeHref", () => {
  it("rejects javascript: URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });
  it("rejects data: URLs", () => {
    expect(safeHref("data:text/html,x")).toBeNull();
  });
  it("rejects plain http: URLs", () => {
    expect(safeHref("http://x")).toBeNull();
  });
  it("rejects protocol-relative URLs", () => {
    expect(safeHref("//x")).toBeNull();
  });
  it("rejects a URL with leading whitespace", () => {
    expect(safeHref(" https://x")).toBeNull();
  });
  it("accepts a plain https: URL", () => {
    expect(safeHref("https://ok.example")).toBe("https://ok.example");
  });
});

describe("fixture A: two protocols, one hostile", () => {
  let build: BuildResult;

  beforeAll(() => {
    build = runBuild({
      registryDir: path.join(FIXTURES, "registry-a"),
      statusUrl: `file://${path.join(FIXTURES, "status-a.json")}`,
    });
    if (build.status !== 0) {
      throw new Error(`build failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
  });

  it("builds successfully", () => {
    expect(build.status).toBe(0);
  });

  it("every HTML page in the output is safe", () => {
    const files = allHtmlFiles(build.outDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      assertPageIsSafe(readFileSync(file, "utf8"), path.relative(build.outDir, file));
    }
  });

  it("shows the hostile protocol name only as escaped text", () => {
    const indexHtml = readFileSync(path.join(build.outDir, "index.html"), "utf8");
    // The raw source carries the *escaped* form — this is the safe outcome, not a failure.
    expect(indexHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(indexHtml).not.toContain("<script>alert(1)</script>");
    // The parsed, decoded text content is where the literal hostile name must still be visible to a reader.
    const root = parse(indexHtml);
    const text = root.querySelector("body")!.textContent;
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("renders the hostile protocol's own page with the hostile strings only as text", () => {
    const detailHtml = readFileSync(path.join(build.outDir, "p", "hostile", "index.html"), "utf8");
    const root = parse(detailHtml);
    const text = root.querySelector("body")!.textContent;
    expect(text).toContain("<script>alert(1)</script>");
    expect(text).toContain('"><img src=x onerror=alert(1)>');
  });

  it("writes registry.json with every id and the right state", () => {
    const registryJson = JSON.parse(readFileSync(path.join(build.outDir, "registry.json"), "utf8"));
    expect(Array.isArray(registryJson)).toBe(true);
    const byId = Object.fromEntries(registryJson.map((row: { id: string }) => [row.id, row]));
    expect(byId.yourprotocol.state).toBe("conformant");
    expect(byId.hostile.state).toBe("failing");
    expect(byId["another-protocol"].state).toBe("unchecked");
  });

  it("writes checkedAt: null for an unchecked protocol, even though its status row has its own checkedAt", () => {
    // Regression test: the live-check's `unchecked` row (no MCP_KEY stored yet) still carries a `checkedAt` — the
    // run's own timestamp — because `ProtocolStatus` requires one. `/registry.json`'s contract is that `checkedAt`
    // is null exactly when the protocol has never actually been checked, so the site must not just forward the
    // status row's `checkedAt` for that state.
    const registryJson = JSON.parse(readFileSync(path.join(build.outDir, "registry.json"), "utf8"));
    const byId = Object.fromEntries(registryJson.map((row: { id: string }) => [row.id, row]));
    expect(byId["another-protocol"].checkedAt).toBeNull();
    expect(byId.yourprotocol.checkedAt).not.toBeNull();
  });

  it("shows the Listed state and its explanatory sentence for an unchecked protocol", () => {
    const html = readFileSync(path.join(build.outDir, "p", "another-protocol", "index.html"), "utf8");
    const text = parse(html).querySelector("body")!.textContent;
    expect(text).toContain("Listed");
    expect(text).toContain("Listed means the manifest was reviewed and merged. It makes no claim about the live server.");
  });

  it("sorts the directory conformant, then failing, then unchecked", () => {
    const html = readFileSync(path.join(build.outDir, "index.html"), "utf8");
    const root = parse(html);
    const ids = root.querySelectorAll(".protocol-card .card-link").map((a) => a.attributes.href);
    expect(ids).toEqual(["/p/yourprotocol", "/p/hostile", "/p/another-protocol"]);
  });
});

describe("fixture B: empty registry, status branch not yet created", () => {
  let build: BuildResult;

  beforeAll(() => {
    build = runBuild({
      registryDir: path.join(FIXTURES, "registry-empty"),
      statusUrl: `file://${path.join(FIXTURES, "status-does-not-exist.json")}`,
    });
    if (build.status !== 0) {
      throw new Error(`build failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
  });

  it("builds successfully", () => {
    expect(build.status).toBe(0);
  });

  it("renders the empty state on the index page", () => {
    const html = readFileSync(path.join(build.outDir, "index.html"), "utf8");
    expect(html).toContain("No protocol is listed yet");
  });

  it("writes an empty registry.json array", () => {
    const registryJson = JSON.parse(readFileSync(path.join(build.outDir, "registry.json"), "utf8"));
    expect(registryJson).toEqual([]);
  });
});

describe("fixture C: status.json is not valid JSON", () => {
  it("fails the build", () => {
    const build = runBuild({
      registryDir: path.join(FIXTURES, "registry-empty"),
      statusUrl: `file://${path.join(FIXTURES, "status-invalid.json")}`,
    });
    expect(build.status).not.toBe(0);
  });
});
