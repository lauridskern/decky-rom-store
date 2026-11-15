import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Defaults to this checkout, so the scripts run without any environment.
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.env.PLUGIN_DIR ?? path.resolve(here, "../..");

const out = (name) => path.join(pluginDir, "tools/preview", name);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(1500);
await page.locator(".rs-search-wrap input").fill("mario");
await page.waitForTimeout(4000);
await page.screenshot({ path: out("store.png") });

await page.locator(".rs-header .rs-steam-btn").nth(0).click({ force: true });
await page.waitForTimeout(700);
await page.screenshot({ path: out("downloads.png") });
await page.locator(".rs-panel.drawer .rs-panel-head .rs-btn").last().click({ force: true });
await page.waitForTimeout(400);

// Header buttons: downloads, installed games, settings (last).
await page.locator(".rs-header .rs-steam-btn").nth(1).click({ force: true });
await page.waitForTimeout(700);
await page.screenshot({ path: out("installed.png") });
await page.locator(".rs-panel.library .rs-lib-close").click({ force: true });
await page.waitForTimeout(400);

await page.locator(".rs-header .rs-steam-btn").last().click({ force: true });
await page.waitForTimeout(900);
await page.screenshot({ path: out("settings.png") });
await page.locator(".rs-panel.settings .rs-panel-head .rs-btn").click({ force: true });
await page.waitForTimeout(400);

await page.locator(".rs-card").first().click({ force: true });
await page.waitForTimeout(1500);
await page.screenshot({ path: out("detail.png") });

const grid = await page.evaluate(() => {
  const row = document.querySelector(".rs-grid");
  if (!row) return null;
  const cards = [...row.children];
  // Covers in a row differ in height (each takes its art's shape) but share
  // a top edge, so count the row by its tops.
  const top = cards[0]?.getBoundingClientRect().top;
  return {
    perRow: cards.filter((c) => Math.round(c.getBoundingClientRect().top) === Math.round(top)).length,
    total: cards.length,
  };
});
console.log("grid:", JSON.stringify(grid));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
