// Bundles the CLI into one file that runs on any OS with Node 24+.
import { build } from "esbuild";

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/narthex.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __narthexRequire } from 'node:module'; const require = __narthexRequire(import.meta.url);",
  },
  logLevel: "info",
});
