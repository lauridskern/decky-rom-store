/**
 * Bundles the plugin's React components with stubbed Decky modules so the
 * whole UI can run in a normal browser (file://tools/preview/index.html).
 *
 * Run `npm install` once inside tools/preview, then `npm run build` here.
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, "node_modules");

if (!fs.existsSync(path.join(modules, "react"))) {
  console.error(
    "tools/preview/node_modules is missing.\n" +
      "Run:  cd tools/preview && npm install\n" +
      "and, only the first time on a machine:  npx playwright install chromium",
  );
  process.exit(1);
}

await esbuild.build({
  entryPoints: [path.join(here, "preview.tsx")],
  bundle: true,
  outfile: path.join(here, "preview.js"),
  jsx: "automatic",
  loader: { ".png": "dataurl" },
  alias: {
    "@decky/api": path.join(here, "mock-api.ts"),
    "@decky/ui": path.join(here, "mock-ui.tsx"),
    react: path.join(modules, "react"),
    "react/jsx-runtime": path.join(modules, "react/jsx-runtime"),
    "react-dom": path.join(modules, "react-dom"),
    "react-dom/client": path.join(modules, "react-dom/client.js"),
  },
  logLevel: "info",
});
