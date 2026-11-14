import { chromium } from "playwright";
import path from "node:path";

const pluginDir = process.env.PLUGIN_DIR;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  window.__ROM_COUNT = 60;
  window.__long = [];
  window.__frames = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.duration > 32) window.__long.push(Math.round(e.duration));
  }).observe({ entryTypes: ["longtask"] });
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(1200);
await page.locator(".rs-search-wrap input").fill("mario");
await page.waitForSelector(".rs-card", { timeout: 20000 });
await page.waitForTimeout(1500);

// scroll hard for a few seconds
await page.evaluate(async () => {
  const main = document.querySelector(".rs-main");
  const step = 60;
  for (let i = 0; i < 120; i += 1) {
    main.scrollTop = (main.scrollTop + step) % (main.scrollHeight - main.clientHeight);
    await new Promise((r) => requestAnimationFrame(r));
  }
});
await page.waitForTimeout(800);

const stats = await page.evaluate(() => {
  const frames = window.__frames.filter((f) => f > 0);
  frames.sort((a, b) => a - b);
  const pct = (p) => Math.round(frames[Math.floor(frames.length * p)] || 0);
  return {
    frames: frames.length,
    median: pct(0.5),
    p95: pct(0.95),
    worst: Math.round(frames[frames.length - 1] || 0),
    longTasks: window.__long,
    cards: document.querySelectorAll(".rs-card").length,
  };
});
console.log("frame times (ms):", JSON.stringify(stats));
await browser.close();
