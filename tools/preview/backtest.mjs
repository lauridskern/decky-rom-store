import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Defaults to this checkout, so the scripts run without any environment.
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.env.PLUGIN_DIR ?? path.resolve(here, "../..");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(1200);
await page.locator(".rs-search-wrap input").fill("mario");
await page.locator(".rs-card").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

const state = async (label) => {
  const value = await page.evaluate(() => ({
    historyLength: window.history.length,
    url: window.location.href.split("/").pop(),
    gamePage: !!document.querySelector(".rs-page"),
    home: !!document.querySelector(".rs-home"),
  }));
  console.log(`  ${label.padEnd(26)}`, JSON.stringify(value));
};

await state("before opening");
await page.locator(".rs-card").first().click({ force: true });
await page.waitForTimeout(600);
await state("after opening");

// The Steam client sends the user back by popping the history.
await page.evaluate(() => window.history.back());
await page.waitForTimeout(700);
await state("after pressing back");

// Open again and close with the X button.
await page.locator(".rs-card").first().click({ force: true });
await page.waitForTimeout(600);
await state("opened again");
await page.locator(".rs-close").click({ force: true });
await page.waitForTimeout(700);
await state("after closing with X");

// Back on the results is the way home; back on the home screen leaves the store.
await page.evaluate(() => window.history.back());
await page.waitForTimeout(700);
await state("back on the results");

// A tab and back: no history entries pile up.
await page.keyboard.press("e");
await page.waitForTimeout(300);
await page.keyboard.press("q");
await page.waitForTimeout(300);
await state("after a tab round trip");

await browser.close();
