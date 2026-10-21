import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Externalize ONLY native modules (those need a real .node file on disk).
    // Everything else — including @photon-ai/imessage-kit and its ESM-only dep
    // @parseaple/typedstream — gets inlined so Vite can bridge ESM↔CJS at
    // build time. Without this, Node 20's strict require()-of-ESM error
    // crashes the bundle on first import.
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@photon-ai/imessage-kit", "@parseaple/typedstream"],
      }),
    ],
    build: {
      rollupOptions: {
        external: ["better-sqlite3", "bun:sqlite", "electron", /^node:/],
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
