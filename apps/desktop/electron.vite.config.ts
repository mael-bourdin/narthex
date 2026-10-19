import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// The workspace packages ship TypeScript sources: bundle them instead of requiring them at runtime.
const workspace = { exclude: ["@narthex/core", "@narthex/engine"] };

// The geist package does not export its font files; find them wherever npm hoisted it.
let geistFonts = resolve(import.meta.dirname, "node_modules/geist/dist/fonts");
for (let dir = import.meta.dirname; !existsSync(geistFonts) && dir !== dirname(dir); dir = dirname(dir)) {
  geistFonts = resolve(dirname(dir), "node_modules/geist/dist/fonts");
}

export default defineConfig({
  main: {
    build: { externalizeDeps: workspace },
  },
  preload: {
    build: {
      externalizeDeps: workspace,
      // Sandboxed preloads must be CommonJS.
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    build: { rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/index.html") } },
    plugins: [react()],
    resolve: { alias: { "@geist-fonts": geistFonts } },
  },
});
