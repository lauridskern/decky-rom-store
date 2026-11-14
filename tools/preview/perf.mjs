import { chromium } from "playwright";
import path from "node:path";

const pluginDir = process.env.PLUGIN_DIR;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 40) window.__long.push(Math.round(entry.duration));
    }
  }).observe({ entryTypes: ["longtask"] });
});

await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(1200);

const t0 = Date.now();
await page.locator(".rs-search-wrap input").fill("mario");
await page.waitForSelector(".rs-card", { timeout: 15000 });
await page.waitForTimeout(600);
const render = Date.now() - t0;

// scroll the grid and collect long tasks
await page.evaluate(() => {
  const main = document.querySelector(".rs-main");
  main.scrollTop = main.scrollHeight;
});
await page.waitForTimeout(1200);

const stats = await page.evaluate(() => ({
  longTasks: window.__long,
  nodes: document.querySelectorAll("*").length,
}));

console.log("time to first card :", render, "ms");
console.log("long tasks (scroll):", JSON.stringify(stats.longTasks));
console.log("dom nodes          :", stats.nodes);
await browser.close();
