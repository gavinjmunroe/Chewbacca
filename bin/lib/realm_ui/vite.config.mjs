// Builds Realm's desktop renderer (Carlton Aikins, github.com/31Carlton7/realm,
// apps/desktop/src/renderer) as a static bundle for the Chewbacca glass.
//
// bin/realm-ui copies the renderer and the two workspace packages it imports
// (@realm/contracts, @realm/ui) next to this file, then runs `vite build`
// here. The plugins are Carlton's own from apps/desktop/electron.vite.config.ts,
// copied as written; electron-vite's renderer target is plain Vite underneath,
// so the only differences are the two below.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { scaleTextSizes } from "./apps/desktop/src/renderer/src/theme/text-scale";

// From electron.vite.config.ts (Carlton Aikins): KaTeX's woff and truetype faces
// are dropped so the bundle ships one format.
const katexWoff2Only = () => ({
  name: "realm:katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("katex") || !id.endsWith(".css")) return null;
    const out = code.replace(
      /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g,
      "",
    );
    return out === code ? null : { code: out, map: null };
  },
});

// From electron.vite.config.ts (Carlton Aikins): the text-size preference
// multiplies every size in styles.css at build time.
const textScale = () => ({
  name: "realm:text-scale",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]src[\\/]renderer[\\/]src[\\/]styles\.css(?:\?.*)?$/.test(id))
      return null;
    return { code: scaleTextSizes(code), map: null };
  },
});

// Difference one: Electron's preload put window.realm on the page before any
// script ran. Here a classic script served by server.mjs does it, ahead of the
// module entry, so the bundle sees the same global on its first line.
//
// The entry, never an edit to his files: index.html's module entry is
// pointed at one of ours, which imports his own src/main.tsx unchanged.
// REALM_UI_MODE (set by realm_ui.build) picks which:
//   stock (default)  stock/main.tsx: his app as he ships it, plus the
//                    folder chooser and file describer a web view needs
//   glass (opt-in)   glass/main.tsx: our tiles, story and bar layer over it
//   bare (checks)    his /src/main.tsx itself, only the bridge added: the
//                    reference the stock build is compared against
// A renderer whose index.html no longer names /src/main.tsx fails the build
// here instead of shipping without our entry.
const MODE = ["glass", "bare"].includes(process.env.REALM_UI_MODE) ? process.env.REALM_UI_MODE : "stock";
const glassEntry = () => ({
  name: "chewbacca:glass-entry",
  // Before Vite resolves the module entry, so the bundle is built from ours.
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      if (!html.includes('src="/src/main.tsx"')) {
        throw new Error("realm-ui: index.html no longer loads /src/main.tsx; there is no entry to wrap");
      }
      return MODE === "bare" ? html : html.replace('src="/src/main.tsx"', `src="/${MODE}/main.tsx"`);
    },
  },
});

const glassBridge = () => ({
  name: "chewbacca:realm-bridge",
  transformIndexHtml(html) {
    return html.replace(
      '<script type="module"',
      '<script src="/realm-bridge.js"></script><script type="module"',
    );
  },
});

export default defineConfig({
  root: "apps/desktop/src/renderer",
  base: "/",
  plugins: [
    katexWoff2Only(),
    textScale(),
    react(),
    tailwindcss(),
    glassEntry(),
    glassBridge(),
  ],
  resolve: {
    // Difference two: Realm's @realm/ui imports the paid Hugeicons Pro pack,
    // which needs Carlton's token to install. Every one of the 184 icons it
    // names exists under the same name in the free pack (checked 2026-10-11
    // against @hugeicons/core-free-icons 1.2.1), so the import is pointed there.
    // The free set draws its own stroke-rounded shapes, so a few glyphs differ.
    alias: {
      "@hugeicons-pro/core-stroke-rounded": "@hugeicons/core-free-icons",
    },
  },
  build: {
    outDir: "../../../../dist",
    // Kept, not emptied: the page Kyber keeps loaded across a rebuild still
    // runs the last build until it reloads itself off the glass, and its lazy
    // chunks (CodeEditor, IconPickerEmoji, KaTeX fonts: 125 assets on 10/12)
    // must still be there when it asks. realm_ui.build prunes all but the
    // last two builds' files.
    emptyOutDir: false,
    // electron-vite targets the Chromium Electron ships; noVNC (the machine
    // pane) uses top-level await, which Vite's default browser target refuses.
    // WKWebView on macOS 15 is Safari 18, which has had it since Safari 15.
    target: ["safari16", "chrome120"],
    // Measured on the first build: mermaid and the CodeMirror languages put
    // several chunks past Vite's 500 kB warning, which is expected for a
    // desktop app served from loopback.
    chunkSizeWarningLimit: 8000,
  },
});
