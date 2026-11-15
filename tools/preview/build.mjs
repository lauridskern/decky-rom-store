/**
 * Bundles the plugin's React components with stubbed Decky modules so the
 * whole UI can run in a normal browser (file://tools/preview/index.html).
 *
 * Run `npm install` once inside tools/preview, then `npm run build` here.
 * For live editing use `npm run dev` instead (see dev.mjs).
 */
import * as esbuild from "esbuild";
import { options, requireModules } from "./options.mjs";

requireModules();
await esbuild.build(options);
