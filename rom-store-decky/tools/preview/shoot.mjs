import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..", "..");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(2500);

await page.screenshot({ path: path.join(pluginDir, "tools/preview/store.png") });

// Open the detail overlay of the first card.
const card = page.locator(".rs-card").first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(pluginDir, "tools/preview/detail.png") });
}

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
