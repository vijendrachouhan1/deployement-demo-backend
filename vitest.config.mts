import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./src/tests/global-setup.ts"],
    setupFiles: ["./src/tests/setup.ts"],
    include: ["**/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
