/**
 * Screenshots of every screen, taken the way a Deck is used: with the pad.
 * Keys stand in for buttons (see mock-ui.tsx): arrows = d-pad, Enter = A,
 * Escape = B, x / y, q / e = L1 / R1, z / c = L2 / R2.
 *
 * Every step also says where focus ended up; a step that leaves focus
 * somewhere else than expected is listed as a failure.
 */
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

const failures = [];
const focus = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "(nothing)";
    const cls = typeof el.className === "string" ? el.className.split(" ").filter((c) => c.startsWith("rs-")).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  });
/** The focused element, or one of its ancestors, matches the selector. */
const expectFocus = async (step, selector) => {
  const ok = await page.evaluate((sel) => !!document.activeElement?.closest(sel), selector);
  const where = await focus();
  console.log(`${ok ? "ok  " : "FAIL"} ${step.padEnd(34)} focus: ${where}`);
  if (!ok) failures.push(`${step}: expected ${selector}, focus is on ${where}`);
};
const key = async (name, wait = 250) => {
  await page.keyboard.press(name);
  await page.waitForTimeout(wait);
};

await page.goto(`file://${path.join(pluginDir, "tools/preview/index.html")}`);
await page.waitForTimeout(1500);

// --- home
await expectFocus("store opens on the first shelf", ".rs-shelf-tile");
await page.screenshot({ path: out("home.png") });
await key("ArrowDown");
await expectFocus("down to the next shelf", ".rs-shelf-tile");
await key("ArrowUp");
await key("ArrowUp");
await expectFocus("up to the tabs", ".rs-tab");

// --- search
await key("x");
await expectFocus("X", ".rs-search-wrap");
await page.keyboard.type("mario");
await page.waitForTimeout(4000);
await key("ArrowDown");
await expectFocus("down from search", ".rs-filterbar");
await key("ArrowDown");
await expectFocus("down to the grid", ".rs-card");
await key("ArrowRight");
await key("ArrowRight");
await page.screenshot({ path: out("store.png") });
const strip = await page.evaluate(() => document.querySelector(".rs-strip-title")?.textContent ?? null);
console.log("info strip:", JSON.stringify(strip));
if (!strip) failures.push("the info strip does not name the focused cover");

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

// --- game page
await key("Enter", 1800);
await expectFocus("A on a cover", ".rs-page .rs-cta-btn");
await page.screenshot({ path: out("detail.png") });
await key("e", 900);
await expectFocus("R1 on the game page", ".rs-page .rs-cta-btn");
await key("Escape", 500);
await expectFocus("B closes the game page", ".rs-card");

// --- tabs
await key("e", 900);
await expectFocus("R1: library", '[data-view="library"], .rs-tab[data-tab="library"]');
await page.screenshot({ path: out("library.png") });
await key("Enter", 1200);
await expectFocus("A on a game: its page with mods", ".rs-modpage");
await page.screenshot({ path: out("mods.png") });
await key("Escape", 600);
await expectFocus("B closes the game page", ".rs-lib-card");
await key("x", 500);
await expectFocus("X on a game: Keep has focus", ".rs-lib-keep");
await key("Escape", 500);
await expectFocus("B answers Keep", ".rs-lib-card");
await key("e", 900);
await expectFocus("R1: downloads", '[data-view="downloads"], .rs-tab[data-tab="downloads"]');
await page.screenshot({ path: out("downloads.png") });
await key("e", 900);
await expectFocus("R1: settings", '[data-view="settings"], .rs-tab[data-tab="settings"]');
await page.screenshot({ path: out("settings.png") });
await key("q", 600);
await expectFocus("L1: downloads", '[data-view="downloads"]');
await key("Escape", 600);
await expectFocus("B on a tab: back in the store", ".rs-card");

// --- back to the home screen
await key("Escape", 700);
await expectFocus("B on the results", ".rs-shelf-tile, .rs-console");
const home = await page.evaluate(() => !!document.querySelector(".rs-home"));
const tiles = await page.evaluate(() => document.querySelectorAll(".rs-console").length);
console.log("console tiles:", tiles);
if (tiles < 30) failures.push(`only ${tiles} consoles on the home screen`);
// Nothing in the store shows a scrollbar.
const bars = await page.evaluate(() =>
  [...document.querySelectorAll(".rs-store *:not(input)")].filter((el) => el.offsetWidth - el.clientWidth > 1 && getComputedStyle(el).overflowY !== "visible").length,
);
if (bars) failures.push(`${bars} elements show a scrollbar`);
if (!home) failures.push("B on the results did not bring the home screen back");

console.log("failures:", failures.length ? failures : "none");
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
if (failures.length || errors.length) process.exit(1);
