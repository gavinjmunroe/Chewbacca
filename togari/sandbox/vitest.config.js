import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.js"],
    environment: "node",
    passWithNoTests: true,
  },
});
