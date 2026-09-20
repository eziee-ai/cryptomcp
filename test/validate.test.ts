import { describe, expect, it } from "vitest";
import { validateSubmission, type ValidateDeps, type ValidateInput } from "../validator/validate";
import { fakeClient, fixtureFiles, FIXTURE_CHAINS, json, parsed, USDC } from "./helpers";

const TEMPLATE = "eziee-ai/protocol-mcp-template";

function setup(change: { files?: (files: Map<string, Uint8Array>) => void; input?: Partial<ValidateInput>; deps?: Partial<ValidateDeps>; github?: Partial<ValidateDeps["github"]> } = {}) {
  const files = fixtureFiles();
  change.files?.(files);
  const input: ValidateInput = { id: "yourprotocol", author: "alice", files, existingMaintainers: null, chains: FIXTURE_CHAINS, reserved: ["uniswap", "sky"], ...change.input };
  const deps: ValidateDeps = {
    clientFor: () => fakeClient(),
    // The owner of yourprotocol.example has said, in DNS, that this repository speaks for it.
    resolveTxt: async (name) => (name === "_cryptomcp.yourprotocol.example" ? ["v=spf1 -all", "cryptomcp-repo=eziee-ai/protocol-mcp-template"] : Promise.reject(new Error("ENOTFOUND"))),
    github: {
      getRepo: async () => ({ private: false, templateRepository: TEMPLATE }),
      // The protocol's own repository carries the very manifest that was submitted.
      getFile: async () => ({ type: "file", size: files.get("manifest.json")!.byteLength, bytes: files.get("manifest.json")! }),
      hasCommitsBy: async () => true,
      ...change.github,
    },
    ...change.deps,
  };
  return validateSubmission(input, deps);
}

const failures = async (run: ReturnType<typeof setup>) => (await run).filter((finding) => finding.status === "fail").map((finding) => finding.check);
const edit = (name: string, change: (value: Record<string, any>) => void) => (files: Map<string, Uint8Array>) => {
  const value = parsed(files, name);
  change(value);
  files.set(name, json(value));
};

describe("validateSubmission", () => {
  it("passes a good submission, and says what it did not check", async () => {
    const findings = await setup();
    expect(findings.filter((finding) => finding.status === "fail")).toEqual([]);
    expect(findings.filter((finding) => finding.status === "pass").length).toBeGreaterThan(8);
    // Everything it cannot do is listed as not run and marked manual, never silently absent.
    const manual = findings.filter((finding) => finding.manual).map((finding) => finding.check);
    expect(manual).toEqual(expect.arrayContaining(["signatures match verified source", "simulated asset movements equal the decoded spend", "the live server conforms"]));
    expect(findings.filter((finding) => finding.status === "not-run" && !finding.manual)).toEqual([]);
  });

  it("fails when a file of the entry is missing", async () => {
    expect(await failures(setup({ files: (files) => files.delete("samples.json") }))).toContain("the entry has its four files");
  });

  it("fails an oversized file without parsing it", async () => {
    expect(await failures(setup({ files: (files) => files.set("manifest.json", new Uint8Array(64 * 1024 + 1)) }))).toEqual(["manifest.json is within its size limit"]);
  });

  it("fails JSON that does not parse, including JSON nested too deep to parse", async () => {
    expect(await failures(setup({ files: (files) => files.set("manifest.json", new TextEncoder().encode("{")) }))).toContain("manifest.json parses");
    expect(await failures(setup({ files: (files) => files.set("samples.json", new TextEncoder().encode("[".repeat(15000))) }))).toContain("samples.json parses");
  });

  it("fails a manifest eziee's parser refuses, quoting why", async () => {
    const findings = await setup({ files: edit("manifest.json", (manifest) => (manifest.contracts["900001"].router.admin = "x")) });
    expect(findings.find((finding) => finding.check === "manifest.json parses")).toMatchObject({ status: "fail", detail: expect.stringContaining("admin") });
  });

  it("fails an id that is not the folder's", async () => {
    expect(await failures(setup({ input: { id: "acme" } }))).toContain("the manifest's id is the folder's name");
  });

  it("fails a manifest without an https server URL", async () => {
    expect(await failures(setup({ files: edit("manifest.json", (manifest) => delete manifest.mcp) }))).toContain("the manifest names its server");
    expect(await failures(setup({ files: edit("manifest.json", (manifest) => (manifest.mcp.url = "http://mcp.example/mcp")) }))).toContain("the manifest names its server");
    expect(await failures(setup({ files: edit("manifest.json", (manifest) => (manifest.mcp.url = "https://user:pw@mcp.example/mcp")) }))).toContain("the manifest names its server");
  });

  it("fails an action without a sample, a sample without an action, and a sample on a chain the manifest does not list", async () => {
    expect(await failures(setup({ files: edit("samples.json", (samples) => delete samples.closePosition) }))).toContain("every action has a sample");
    expect(await failures(setup({ files: edit("samples.json", (samples) => (samples.rugPull = samples.swap)) }))).toContain("every sample is for an action");
    expect(await failures(setup({ files: edit("samples.json", (samples) => (samples.swap.chainId = 1)) }))).toContain("every sample is on one of the manifest's chains");
  });

  it("fails a chain that is not in chains.json, and asks nothing of that chain", async () => {
    let asked = 0;
    const run = setup({ input: { chains: {} }, deps: { clientFor: () => (asked++, fakeClient()) } });
    expect(await failures(run)).toContain("chain 900001 is one this registry supports");
    expect(asked).toBe(0);
  });

  it("fails when an RPC answers as another chain, or cannot be reached", async () => {
    expect(await failures(setup({ deps: { clientFor: () => fakeClient({ chainId: 1 }) } }))).toContain("[900001] the RPC answers as this chain");
    const down = { getChainId: async () => Promise.reject(new Error("fetch failed https://secret-rpc")) } as never;
    const findings = await setup({ deps: { clientFor: () => down } });
    expect(findings.find((finding) => finding.check === "[900001] the RPC answers as this chain")).toMatchObject({ status: "fail", detail: expect.not.stringContaining("secret-rpc") });
  });

  it("fails a contract without code and a token that answers differently", async () => {
    expect(await failures(setup({ deps: { clientFor: () => fakeClient({ code: { "0x0000000000000000000000000000000000000101": "0x" } }) } }))).toContain("[900001] contract router has code");
    expect(await failures(setup({ deps: { clientFor: () => fakeClient({ tokens: { [USDC]: { symbol: "USDC", decimals: 18 } } }) } }))).toContain("[900001] token USDC decimals");
  });

  it("fails a bad icon", async () => {
    expect(await failures(setup({ files: (files) => files.set("icon.svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="x"/>')) }))).toContain("icon.svg is an inert SVG");
  });

  describe("who may submit", () => {
    it("requires a first submission's author to be one of its maintainers, in any case", async () => {
      expect(await failures(setup({ input: { author: "mallory" } }))).toContain("the author may change this entry");
      expect(await failures(setup({ input: { author: "ALICE" } }))).toEqual([]);
    });

    it("judges an update by the maintainers already on main, never by the list in the pull request", async () => {
      // mallory adds herself to the list in her own pull request. The list on main does not have her.
      const run = setup({ input: { author: "mallory", existingMaintainers: ["alice"] }, files: edit("entry.json", (entry) => entry.maintainers.push("mallory")) });
      expect(await failures(run)).toContain("the author may change this entry");
      expect(await failures(setup({ input: { author: "alice", existingMaintainers: ["alice"] } }))).toEqual([]);
    });
  });

  describe("the link to the protocol's own repository", () => {
    it("fails a repository that is private or missing", async () => {
      expect(await failures(setup({ github: { getRepo: async () => null } }))).toContain("the protocol's repository is public");
      expect(await failures(setup({ github: { getRepo: async () => ({ private: true, templateRepository: null }) } }))).toContain("the protocol's repository is public");
    });

    it("fails when the manifest there is not byte for byte the one submitted", async () => {
      const other = new TextEncoder().encode("{}");
      expect(await failures(setup({ github: { getFile: async () => ({ type: "file", size: 2, bytes: other }) } }))).toContain("the repository holds this manifest at the listed commit");
      expect(await failures(setup({ github: { getFile: async () => null } }))).toContain("the repository holds this manifest at the listed commit");
      expect(await failures(setup({ github: { getFile: async () => ({ type: "symlink", size: 10, bytes: other }) } }))).toContain("the repository holds this manifest at the listed commit");
    });

    it("asks GitHub for exactly the repository and commit the entry names", async () => {
      const calls: unknown[] = [];
      const files = fixtureFiles();
      await setup({ github: { getFile: async (...args) => (calls.push(args), { type: "file", size: 1, bytes: files.get("manifest.json")! }) } });
      expect(calls).toEqual([["eziee-ai/protocol-mcp-template", "registry/yourprotocol/manifest.json", "c1df5263f4aa21c84442f9890df25982852ee2ed"]]);
    });

    it("notes, without failing, a repository not made from the template and an author with no commits in it", async () => {
      const findings = await setup({ github: { getRepo: async () => ({ private: false, templateRepository: null }), hasCommitsBy: async () => false } });
      expect(findings.filter((finding) => finding.status === "fail")).toEqual([]);
      expect(findings.filter((finding) => finding.status === "note").map((finding) => finding.check)).toEqual(["the repository was created from protocol-mcp-template", "the author has commits in the protocol's repository"]);
    });

    it("reports a GitHub outage as a failure, not as a pass", async () => {
      expect(await failures(setup({ github: { getRepo: async () => Promise.reject(new Error("502")) } }))).toContain("the protocol's repository is public");
    });
  });

  describe("who this really is", () => {
    const asUniswap = edit("manifest.json", (manifest) => Object.assign(manifest, { name: "Uniswap V4", homepage: "https://uniswap.org", mcp: { url: "https://mcp.uniswap.org/mcp", transport: "streamable-http" } }));

    it("fails a well-known name taken by a first submission, by id or by the start of the display name", async () => {
      expect(await failures(setup({ files: asUniswap }))).toContain("the name is not a reserved one");
      expect(await failures(setup({ input: { reserved: ["yourprotocol"] } }))).toContain("the name is not a reserved one");
    });

    it("does not let a short reserved word block a longer name, and leaves an existing entry its name", async () => {
      expect(await failures(setup({ files: edit("manifest.json", (manifest) => (manifest.name = "Skyline")) }))).toEqual([]);
      expect(await failures(setup({ input: { reserved: ["yourprotocol"], existingMaintainers: ["alice"] } }))).toEqual([]);
    });

    it("fails a server that is not on the homepage's domain", async () => {
      expect(await failures(setup({ files: edit("manifest.json", (manifest) => (manifest.mcp.url = "https://mcp.evil.example/mcp")) }))).toContain("the server is on the homepage's domain");
      // A suffix that merely ends the same way is not a subdomain.
      expect(await failures(setup({ files: edit("manifest.json", (manifest) => (manifest.mcp.url = "https://evilyourprotocol.example/mcp")) }))).toContain("the server is on the homepage's domain");
      expect(await failures(setup({ files: edit("manifest.json", (manifest) => Object.assign(manifest, { homepage: "https://203.0.113.7", mcp: { url: "https://203.0.113.7/mcp", transport: "streamable-http" } })) }))).toContain("the server is on the homepage's domain");
    });

    it("fails without a DNS record in which the homepage's domain names this repository", async () => {
      const proof = "the homepage's domain names this repository";
      expect(await failures(setup({ deps: { resolveTxt: async () => [] } }))).toContain(proof);
      expect(await failures(setup({ deps: { resolveTxt: async () => ["cryptomcp-repo=mallory/uniswap-mcp"] } }))).toContain(proof);
      expect(await failures(setup({ deps: { resolveTxt: async () => Promise.reject(new Error("SERVFAIL")) } }))).toContain(proof);
      expect(await failures(setup({ deps: { resolveTxt: async () => ["CryptoMCP-Repo=Eziee-AI/Protocol-MCP-Template "] } }))).toEqual([]);
    });

    it("asks DNS about the homepage's own domain and nothing else", async () => {
      const asked: string[] = [];
      await setup({ deps: { resolveTxt: async (name) => (asked.push(name), []) }, files: edit("manifest.json", (manifest) => Object.assign(manifest, { homepage: "https://www.yourprotocol.example/about?x=1" })) });
      expect(asked).toEqual(["_cryptomcp.yourprotocol.example"]);
    });

    it("cannot be impersonated by naming someone else's homepage: the proof is in THEIR DNS", async () => {
      // mallory submits as Uniswap from her own repository. uniswap.org's DNS says nothing about her.
      const run = setup({ input: { reserved: [], author: "mallory" }, files: (files) => (asUniswap(files), edit("entry.json", (entry) => Object.assign(entry, { repo: "https://github.com/mallory/uniswap-mcp", maintainers: ["mallory"] }))(files)) });
      expect(await failures(run)).toContain("the homepage's domain names this repository");
    });
  });
});
