import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// node-html-parser is only for reading text out of a page in the content assertions. The SAFETY assertions use parse5.
import { parse } from "node-html-parser";
import { parse as parse5 } from "parse5";
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
/** Every element the site's pages are made of. Anything else in the output is something nobody decided to put there. */
const ELEMENTS = new Set(["#document", "#documentType", "#text", "#comment", "html", "head", "meta", "title", "link", "body", "a", "header", "footer", "main", "nav", "section", "article", "h1", "h2", "h3", "h4", "p", "span", "div", "ul", "ol", "li", "dl", "dt", "dd", "img", "picture", "source", "table", "caption", "thead", "tbody", "tr", "th", "td", "code", "pre", "strong", "em", "small", "time", "br"]);
const URL_ATTRIBUTES = new Set(["href", "src", "srcset", "action", "formaction", "poster", "data", "ping", "cite", "manifest", "background", "xlink:href"]);
const STYLESHEETS = /^(\/_astro\/[\w.-]+\.css|https:\/\/api\.fontshare\.com\/v2\/css\?[^"<>\s]*)$/;

interface Node {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: Node[];
  content?: Node;
}

function assertPageIsSafe(html: string, label: string) {
  // A hostile string like `onerror=alert(1)` legitimately appears in the raw source as escaped TEXT, which is the
  // safe outcome, so every check runs on the parsed tree, not as a regex over the source. The parser is parse5, the
  // HTML specification's own algorithm: what it builds is what a browser builds. (A lenient parser drops elements it
  // does not know, and an assertion cannot fail on an element it was never shown.)
  const seen: Node[] = [];
  const walk = (node: Node) => {
    seen.push(node);
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  };
  walk(parse5(html) as unknown as Node);

  for (const node of seen) {
    expect(ELEMENTS.has(node.nodeName), `${label}: <${node.nodeName}> is not an element this site is made of`).toBe(true);
    for (const { name, value } of node.attrs ?? []) {
      const where = `${label}: <${node.nodeName} ${name}="${value}">`;
      expect(name.startsWith("on"), `${where} is an event handler`).toBe(false);
      expect(["style", "srcdoc", "http-equiv", "formaction", "action", "background", "ping"].includes(name), `${where} is not an attribute this site uses`).toBe(false);
      if (!URL_ATTRIBUTES.has(name)) continue;
      // A same-site path, a fragment, or https. Nothing protocol-relative, nothing with another scheme.
      for (const candidate of name === "srcset" ? value.split(",").map((part) => part.trim().split(/\s+/)[0]!) : [value]) {
        expect(/^(\/(?!\/)|#|https:\/\/)/.test(candidate), `${where} is not a same-site path, a fragment or an https: URL`).toBe(true);
      }
    }
    if (node.nodeName === "link") {
      const attrs = Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
      if (attrs.rel === "stylesheet") expect(attrs.href, `${label}: a stylesheet from somewhere unexpected`).toMatch(STYLESHEETS);
    }
    if (node.nodeName === "a") {
      const attrs = Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
      if (attrs.href?.startsWith("https://")) expect((attrs.rel ?? "").split(/\s+/), `${label}: external link ${attrs.href} is missing rel="noopener"`).toContain("noopener");
      // A link never reads as one site while pointing at another.
      if (attrs.href?.startsWith("https://")) expect(new URL(attrs.href).username, `${label}: ${attrs.href} carries credentials`).toBe("");
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
  it("rejects a URL that reads as one site and is on another", () => {
    expect(safeHref("https://uniswap.org@evil.example/claim")).toBeNull();
    expect(safeHref("https://user:pw@ok.example")).toBeNull();
  });
  it("rejects an internationalised domain and an IP address", () => {
    expect(safeHref("https://xn--niswap-235b.org")).toBeNull();
    expect(safeHref("https://203.0.113.7/x")).toBeNull();
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

  it("links an address to its chain's explorer when the chain is one the registry supports", () => {
    const html = readFileSync(path.join(build.outDir, "p", "another-protocol", "index.html"), "utf8");
    expect(html).toMatch(/href="https:\/\/testnet\.arcscan\.app\/address\/0x[0-9a-fA-F]{40}"/);
    // and shows one it does not know as plain text, with no link
    expect(readFileSync(path.join(build.outDir, "p", "yourprotocol", "index.html"), "utf8")).not.toMatch(/\/address\/0x/);
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

describe("fixture D: protocols are listed and the status cannot be found", () => {
  it("fails the build, so a Failing server is never republished as merely Listed", () => {
    const build = runBuild({ registryDir: path.join(FIXTURES, "registry-a"), statusUrl: `file://${path.join(FIXTURES, "no-such-status.json")}` });
    expect(build.status).not.toBe(0);
    expect(build.stdout + build.stderr).toContain("Refusing to build");
  });
});

describe("fixture E: overrides that point outside the repository", () => {
  it("fails the build", () => {
    expect(runBuild({ registryDir: "/etc", statusUrl: `file://${path.join(FIXTURES, "status-a.json")}` }).status).not.toBe(0);
    expect(runBuild({ registryDir: path.join(FIXTURES, "registry-empty"), statusUrl: "file:///etc/hosts" }).status).not.toBe(0);
  });
});

