import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PublicClient } from "viem";
import type { Chains } from "../lib/chains";

const FIXTURE = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/registry/yourprotocol/${name}`, import.meta.url)));

export const FIXTURE_CHAINS: Chains = { "900001": { name: "Fixture Chain", rpc: "https://rpc.fixture.example", explorer: "https://explorer.fixture.example" } };
export const ROUTER = "0x0000000000000000000000000000000000000101";
export const USDC = "0x0000000000000000000000000000000000000201";
export const WETH = "0x0000000000000000000000000000000000000202";

/** The four files of the fixture entry, as the bytes a pull request would carry. Mutable per test. */
export function fixtureFiles(): Map<string, Uint8Array> {
  return new Map(["manifest.json", "samples.json", "icon.svg", "entry.json"].map((name) => [name, new Uint8Array(FIXTURE(name))]));
}

export const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
export const parsed = (files: Map<string, Uint8Array>, name: string) => JSON.parse(new TextDecoder().decode(files.get(name))) as Record<string, any>;

/** A chain as the fixture manifest describes it: code at the router and both tokens, tokens answering as declared. */
export function fakeClient(overrides: { code?: Record<string, string>; tokens?: Record<string, { symbol: string; decimals: number }>; chainId?: number } = {}): PublicClient {
  const code: Record<string, string> = { [ROUTER]: "0x6001", [USDC]: "0x6001", [WETH]: "0x6001", ...overrides.code };
  const tokens: Record<string, { symbol: string; decimals: number }> = { [USDC]: { symbol: "USDC", decimals: 6 }, [WETH]: { symbol: "WETH", decimals: 18 }, ...overrides.tokens };
  return {
    getChainId: async () => overrides.chainId ?? 900001,
    getCode: async ({ address }: { address: string }) => code[address] ?? "0x",
    getStorageAt: async () => `0x${"0".repeat(64)}`,
    readContract: async ({ address, functionName }: { address: string; functionName: "symbol" | "decimals" }) => {
      const token = tokens[address];
      if (!token) throw new Error("execution reverted");
      return token[functionName];
    },
  } as unknown as PublicClient;
}
