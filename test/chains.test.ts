import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChains } from "../lib/chains";

describe("parseChains", () => {
  it("parses the file this repository ships", () => {
    const chains = parseChains(JSON.parse(readFileSync(new URL("../chains.json", import.meta.url), "utf8")));
    expect(Object.keys(chains).length).toBeGreaterThan(0);
  });
  it.each([
    ["an http: RPC", { "1": { name: "x", rpc: "http://rpc.example", explorer: "https://e.example" } }],
    ["a chain id that is not a decimal integer", { "0x1": { name: "x", rpc: "https://rpc.example", explorer: "https://e.example" } }],
    ["an unknown key", { "1": { name: "x", rpc: "https://rpc.example", explorer: "https://e.example", key: "s" } }],
    ["an RPC URL carrying credentials", { "1": { name: "x", rpc: "https://user:pass@rpc.example", explorer: "https://e.example" } }],
  ])("refuses %s", (_name, input) => {
    expect(() => parseChains(input)).toThrow();
  });
});
