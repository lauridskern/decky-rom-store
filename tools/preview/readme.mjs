/**
 * The README screenshots: the store with the showcase catalogue
 * (showcase.json: real games with the art the store would show), drawn on a
 * 1280 x 800 Deck screen with Steam's bars, at twice the resolution.
 *
 *   npm run readme        # writes docs/screenshots/*.jpg
 *
 * Needs the network (the covers and screenshots load from their sites).
 * Walks the store with the pad like shoot.mjs; it checks nothing.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/screenshots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  window.__SHOWCASE = true;
});
page.on("pageerror", (e) => console.error("page error:", String(e)));

const key = async (name, wait = 300) => {
  await page.keyboard.press(name);
  await page.waitForTimeout(wait);
};
/** Every image on screen has loaded (or given up), then a moment to settle. */
const settle = async (extra = 600) => {
  await page
    .waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30000 })
    .catch(() => console.warn("some images did not finish loading"));
  await page.waitForTimeout(extra);
};
const shot = async (name) => {
  await settle();
  const file = path.join(outDir, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 88 });
  console.log(`${name.padEnd(10)} ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
};

await page.goto(`file://${path.join(here, "index.html")}`);
await page.waitForTimeout(1500);

// Home: shelves and consoles.
await shot("home");

// Search, then focus a cover so the info strip names it.
await key("x");
await page.keyboard.type("zelda");
await page.waitForTimeout(3500);
await key("ArrowDown");
await key("ArrowDown");
await key("ArrowRight");
await key("ArrowRight");
await key("ArrowRight");
await shot("results");

// The game page of that cover.
await key("Enter", 2000);
await shot("game");
await key("Escape", 600);

// Library, a game's page with its mods, Downloads, Settings.
await key("e", 1000);
await key("ArrowDown");
await key("ArrowDown");
await shot("library");
await key("Enter", 1500);
await shot("mods");
await key("Escape", 600);
await key("e", 1000);
await shot("downloads");
// Settings on the Steam section (Library, Sources, Downloads, Artwork, Steam).
await key("e", 1000);
for (let i = 0; i < 4; i += 1) await key("ArrowDown", 300);
await page.waitForTimeout(800);
await shot("settings");

await browser.close();
