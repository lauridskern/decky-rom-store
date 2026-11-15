/**
 * esbuild options shared by build.mjs (one-shot bundle for the test scripts)
 * and dev.mjs (watch + local server for working on the UI in a browser).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, "node_modules");

export function requireModules() {
  if (!fs.existsSync(path.join(modules, "react"))) {
    console.error(
      "tools/preview/node_modules is missing.\n" +
        "Run:  cd tools/preview && npm install\n" +
        "and, only the first time on a machine:  npx playwright install chromium",
    );
    process.exit(1);
  }
}

export const options = {
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
};
