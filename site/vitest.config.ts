import { defineConfig } from "vitest/config";

// Builds the real Astro site inside each test, so a generous timeout: an `astro build` subprocess is not fast.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 },
});
