/**
 * Artwork fitting check. Replaces the covers of the first cards with synthetic
 * images of known shapes (3:4, 1:1, 4:3, 2:3, 5:7, 16:9, 9:16) and writes
 * tools/preview/aspects.png. Every picture must be fully visible: the white
 * border drawn inside each test image has to survive on all four sides.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.env.PLUGIN_DIR ?? path.resolve(here, "../..");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  window.__ROM_COUNT = 12;
});
await page.goto(`file://${path.join(here, "index.html")}`);
await page.waitForTimeout(1200);
await page.locator(".rs-search-wrap input").fill("mario");
await page.waitForSelector(".rs-card", { timeout: 15000 });
await page.waitForTimeout(1200);

const ratios = [
  [3, 4],
  [1, 1],
  [4, 3],
  [2, 3],
  [5, 7],
  [16, 9],
  [9, 16],
  [7, 10],
];

await page.evaluate((ratios) => {
  const cards = [...document.querySelectorAll(".rs-card")];
  cards.forEach((card, i) => {
    const [w, h] = ratios[i % ratios.length];
    const W = 400;
    const H = Math.round((400 * h) / w);
    const color = ["#e05a5a", "#5aa0e0", "#5ad07a", "#e0c05a", "#a05ae0", "#e07a3a", "#3ad0c0", "#c0c0c0"][i % 8];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="100%" height="100%" fill="${color}"/>
      <rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#fff" stroke-width="10"/>
      <text x="50%" y="46%" font-family="sans-serif" font-size="${Math.round(W / 6)}" font-weight="700" fill="#111" text-anchor="middle">${w}:${h}</text>
      <text x="50%" y="62%" font-family="sans-serif" font-size="${Math.round(W / 14)}" fill="#111" text-anchor="middle">full art edge visible</text>
    </svg>`;
    const img = card.querySelector(".rs-card-art img");
    if (img) {
      img.removeAttribute("srcset");
      img.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    }
  });
}, ratios);

await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(here, "aspects.png") });

const fits = await page.evaluate(() =>
  [...document.querySelectorAll(".rs-cover-img")].map((el) =>
    el.className.replace("rs-cover-img ", "").trim(),
  ),
);
console.log("fit per slot:", JSON.stringify(fits));
await browser.close();
