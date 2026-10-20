import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    setupFiles: ["./tests/smoke/setup.ts"],
    testTimeout: 10000,
    // Slack/parser code uses console.log liberally; silence for smoke tests.
    silent: true,
    environment: "node",
  },
});
