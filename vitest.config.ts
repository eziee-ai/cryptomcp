import { defineConfig } from "vitest/config";

// The site has its own test, which builds it; it runs from site/.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 } });
