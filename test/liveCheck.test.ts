import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpMcpCaller } from "../kit/mcp/caller";
import { loadRegistry } from "../lib/registry";
import { checkProtocol, type CheckDeps } from "../live-check/check";
import { startFixtureServer } from "./fixtures/server";
import { fakeClient, FIXTURE_CHAINS } from "./helpers";

const [entry] = loadRegistry(fileURLToPath(new URL("./fixtures/registry", import.meta.url)));
const KEY = "k".repeat(40);
const NOW = "2026-09-20T00:00:00.000Z";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function against(options: { dishonest?: boolean; key?: string; deps?: Partial<CheckDeps> }) {
  const server = await startFixtureServer({ apiKey: KEY, dishonest: options.dishonest });
  close = server.close;
  const asked: Array<{ url: string; key: string }> = [];
  const deps: CheckDeps = {
    chains: FIXTURE_CHAINS,
    clientFor: () => fakeClient(),
    // The test server is plain http on localhost. In production the kit's caller refuses anything but https.
    callerFor: (url, key) => (asked.push({ url, key }), createHttpMcpCaller({ url: server.url, apiKey: key, allowInsecure: true })),
    getRepo: async () => ({ private: false, templateRepository: "eziee-ai/protocol-mcp-template" }),
    resolveTxt: async () => ["cryptomcp-repo=eziee-ai/protocol-mcp-template"],
    now: () => NOW,
    ...options.deps,
  };
  return { result: await checkProtocol(entry!, options.key, deps), server, asked };
}

describe("checkProtocol", () => {
  it("finds an honest server conformant, and every action exercised", async () => {
    const { result, asked } = await against({ key: KEY });
    expect(result).toMatchObject({ state: "conformant", checkedAt: NOW, fromTemplate: true, failures: [] });
    expect(result.summary.fail).toBe(0);
    expect(result.summary.pass).toBeGreaterThan(8);
    // The key went to the URL in the reviewed manifest and nowhere else.
    expect(asked).toEqual([{ url: "https://mcp.yourprotocol.example/mcp", key: KEY }]);
  });

  it("finds a server that approves an unlimited amount failing, and names the check", async () => {
    const { result } = await against({ key: KEY, dishonest: true });
    expect(result.state).toBe("failing");
    expect(result.failures.map((failure) => failure.check)).toEqual(["build swap round-trips"]);
    expect(result.failures[0]!.detail).toContain("exactly what the action spends");
  });

  it("asks nothing of the server when no key is stored, and says unchecked", async () => {
    const { result, server, asked } = await against({ key: undefined });
    expect(result).toMatchObject({ state: "unchecked", summary: { pass: 0, fail: 0, notRun: 0 }, failures: [] });
    expect(server.seen).toEqual([]);
    expect(asked).toEqual([]);
    const { result: blank } = await against({ key: "" });
    expect(blank.state).toBe("unchecked");
  });

  it("finds a wrong key failing, not unchecked", async () => {
    const { result } = await against({ key: "wrong".repeat(8) });
    expect(result.state).toBe("failing");
    expect(result.failures[0]!.check).toBe("server lists its tools");
  });

  it("finds a chain that no longer matches the manifest failing", async () => {
    const { result } = await against({ key: KEY, deps: { clientFor: () => fakeClient({ code: { "0x0000000000000000000000000000000000000101": "0x" } }) } });
    expect(result.state).toBe("failing");
    expect(result.failures.map((failure) => failure.check)).toContain("chain 900001: contract router has code");
  });

  it("finds a protocol whose domain no longer names its repository failing", async () => {
    const { result } = await against({ key: KEY, deps: { resolveTxt: async () => [] } });
    expect(result.state).toBe("failing");
    expect(result.failures.map((failure) => failure.check)).toEqual(["the homepage's domain names this repository"]);
  });

  it("records what it could not learn about the repository as unknown, without failing the protocol for it", async () => {
    const { result } = await against({ key: KEY, deps: { getRepo: async () => Promise.reject(new Error("502")) } });
    expect(result).toMatchObject({ state: "conformant", fromTemplate: null });
  });

  it("cleans and caps what a server made it say", async () => {
    const { result } = await against({ key: KEY, dishonest: true });
    for (const failure of result.failures) {
      expect(failure.detail.length).toBeLessThanOrEqual(200);
      expect(failure.detail).not.toMatch(/[<>`\[\]]/);
    }
  });
});
