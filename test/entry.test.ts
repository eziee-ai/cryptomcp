import { describe, expect, it } from "vitest";
import { parseEntry, parseSamples } from "../lib/entry";

const valid = () => ({ repo: "https://github.com/yourorg/yourprotocol-mcp", commit: "a".repeat(40), tagline: "Swaps on Your Protocol", links: { docs: "https://docs.example.org" }, maintainers: ["alice", "bob-2"] });

describe("parseEntry", () => {
  it("accepts a plain entry, with or without links", () => {
    expect(parseEntry(valid()).maintainers).toEqual(["alice", "bob-2"]);
    const { links: _links, ...bare } = valid();
    expect(parseEntry(bare).links).toBeUndefined();
  });

  it.each([
    ["an unknown key", { ...valid(), admin: true }],
    ["a repository that is not on github.com", { ...valid(), repo: "https://gitlab.com/a/b" }],
    ["a repository URL with a path after the name", { ...valid(), repo: "https://github.com/a/b/tree/main" }],
    ["a repository URL with credentials", { ...valid(), repo: "https://x@github.com/a/b" }],
    ["a short commit", { ...valid(), commit: "abc1234" }],
    ["an upper-case commit", { ...valid(), commit: "A".repeat(40) }],
    ["an empty tagline", { ...valid(), tagline: "" }],
    ["a tagline over 80 characters", { ...valid(), tagline: "x".repeat(81) }],
    ["a tagline with a control character", { ...valid(), tagline: `a${String.fromCodePoint(0)}b` }],
    ["a tagline with a direction override", { ...valid(), tagline: `a${String.fromCodePoint(0x202e)}b` }],
    ["a javascript: link", { ...valid(), links: { docs: "javascript:alert(1)" } }],
    ["an http: link", { ...valid(), links: { docs: "http://docs.example.org" } }],
    ["a link key that is not allowed", { ...valid(), links: { telegram: "https://t.me/x" } }],
    ["no maintainers", { ...valid(), maintainers: [] }],
    ["six maintainers", { ...valid(), maintainers: ["a", "b", "c", "d", "e", "f"] }],
    ["a maintainer that is not a login", { ...valid(), maintainers: ["@alice"] }],
    ["the same maintainer twice, in different case", { ...valid(), maintainers: ["alice", "Alice"] }],
  ])("refuses %s", (_name, input) => {
    expect(() => parseEntry(input)).toThrow();
  });

  it("lists every problem, not only the first", () => {
    expect(() => parseEntry({ ...valid(), commit: "x", tagline: "" })).toThrow(/commit.*tagline|tagline.*commit/s);
  });
});

describe("parseSamples", () => {
  it("accepts one intent per action", () => {
    expect(parseSamples({ swap: { chainId: 1, intent: { amountIn: "5" } } }).swap!.chainId).toBe(1);
  });
  it.each([
    ["an array", []],
    ["an unknown key in a sample", { swap: { chainId: 1, intent: {}, account: "0x" } }],
    ["a chain id that is not a positive integer", { swap: { chainId: 0, intent: {} } }],
    ["an intent that is not an object", { swap: { chainId: 1, intent: "x" } }],
    ["an action name that is not one", { "__proto__x y": { chainId: 1, intent: {} } }],
  ])("refuses %s", (_name, input) => {
    expect(() => parseSamples(input)).toThrow();
  });
});
