/**
 * Dev server for the UI preview: rebuilds preview.js whenever anything under
 * src/ or tools/preview changes, serves tools/preview over HTTP and reloads the
 * page after each rebuild.
 *
 *   cd tools/preview && npm run dev      # http://localhost:5174
 *
 * Same mocked @decky/api and @decky/ui as the screenshot scripts, so this is
 * for layout and interaction work, not for anything that needs the backend.
 */
import * as esbuild from "esbuild";
import { here, options, requireModules } from "./options.mjs";

requireModules();

const port = Number(process.env.PORT ?? 5174);

const ctx = await esbuild.context({
  ...options,
  sourcemap: "inline",
  // esbuild's serve mode exposes an SSE stream at /esbuild that fires on
  // every rebuild; reload the page when it does.
  banner: {
    js: 'new EventSource("/esbuild").addEventListener("change", () => location.reload());',
  },
});

await ctx.watch();
const { port: actual } = await ctx.serve({ servedir: here, port, host: "localhost" });
console.log(`ROM Store UI preview: http://localhost:${actual}/`);
