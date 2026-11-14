import { chromium } from "playwright";
import path from "node:path";

const pluginDir = process.env.PLUGIN_DIR;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(1200);
await page.locator(".rs-search-wrap input").fill("mario");
await page.waitForSelector(".rs-card", { timeout: 15000 });
await page.waitForTimeout(800);

const state = async (label) => {
  const value = await page.evaluate(() => ({
    historyLength: window.history.length,
    url: window.location.href.split("/").pop(),
    modalOpen: !!document.querySelector(".rs-panel.detail"),
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

await browser.close();
