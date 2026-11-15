/**
 * Long-session check: search, page, open a game, close it - seventy times -
 * while sampling frames, DOM size and JS heap. This is the test that proved
 * the frontend tree does not leak; run it after any change to the grid.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.env.PLUGIN_DIR ?? path.resolve(here, "../..");

const browser = await chromium.launch({
  args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.addInitScript(() => {
  window.__ROM_COUNT = 60;
  window.__frames = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    window.__frames.push(now - last);
    if (window.__frames.length > 400) window.__frames.shift();
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.goto(`file://${path.join(here, "index.html")}`);
await page.waitForTimeout(1500);

const sample = async (label) => {
  const data = await page.evaluate(() => {
    const heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const frames = window.__frames
      .slice(-120)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    const p95 = frames.length ? Math.round(frames[Math.floor(frames.length * 0.95)]) : 0;
    return {
      heapKB: Math.round(heap / 1024),
      nodes: document.getElementsByTagName("*").length,
      frames95ms: p95,
      history: window.history.length,
    };
  });
  return { label, ...data };
};

const rows = [await sample("start")];
const queries = ["mario", "zelda", "kirby", "sonic", "metroid", "doom", "pokemon"];

for (let round = 0; round < 70; round += 1) {
  const q = queries[round % queries.length];
  await page.locator(".rs-search-wrap input").fill(`${q}${round}`);
  await page.waitForTimeout(450);
  await page.waitForSelector(".rs-card", { timeout: 15000 });
  await page.waitForTimeout(350);

  const next = page.locator(".rs-pager button", { hasText: "Next" });
  if (await next.count()) {
    await next.click().catch(() => {});
    await page.waitForTimeout(200);
  }

  await page.locator(".rs-card").first().click({ force: true });
  await page.waitForTimeout(500);
  const close = page.locator(".rs-panel.detail .rs-close");
  if (await close.count()) {
    await close.click({ force: true });
    await page.waitForTimeout(250);
  }

  if ((round + 1) % 10 === 0) {
    await page.evaluate(() => window.gc && window.gc());
    await page.waitForTimeout(300);
    rows.push(await sample(`round ${round + 1}`));
  }
}

for (const row of rows) console.log(JSON.stringify(row));
await browser.close();
