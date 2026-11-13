import { readFileSync } from "node:fs";
import deckyPlugin from "@decky/rollup";

/**
 * The logo is embedded as a data URI instead of being emitted as an asset:
 * the plugin folder name on the Deck is not known at build time, so a file
 * URL would not resolve.
 */
const virtualLogo = {
  name: "virtual-logo",
  resolveId(id) {
    if (id === "virtual:logo") return "\0virtual:logo";
    return null;
  },
  load(id) {
    if (id !== "\0virtual:logo") return null;
    const file = new URL("./src/assets/logo.png", import.meta.url);
    const data = readFileSync(file).toString("base64");
    return `export default "data:image/png;base64,${data}";`;
  },
};

export default deckyPlugin({
  plugins: [virtualLogo],
});
