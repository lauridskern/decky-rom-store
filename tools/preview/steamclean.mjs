/**
 * Steam library clean-up (src/steam.ts): an Emu Hub emulator change re-points
 * shortcuts, "Remove duplicates" keeps one per game, "Re-add all games" also
 * drops shortcuts of deleted games. Uses the SteamClient mock in preview.tsx.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const fail = (msg) => { errors.push(msg); console.log("FAIL", msg); };
const shortcuts = () => page.evaluate(() => [...window.steamMockShortcuts.values()].map((s) => ({ appid: s.appid, name: s.display_name, exe: s.exe, options: s.options })));

await page.goto(`file://${path.join(here, "index.html")}?full&plugin`);
await page.locator(".rs-tab", { hasText: "Settings" }).first().click().catch(() => page.locator("text=Settings").first().click());
await page.locator("text=Downloaded games in your Steam library.").or(page.getByText("Steam", { exact: true })).first().click();
await page.locator("text=Sync with Steam now").waitFor();
await page.locator("text=Sync with Steam now").click();
await page.locator("text=/Added \\d+/").waitFor();
let list = await shortcuts();
console.log("after sync:", list.length, "shortcuts");
const ff7 = list.find((s) => s.name.startsWith("Final Fantasy VII"));
if (!ff7) fail("no shortcut for Final Fantasy VII");

// An SRM-made duplicate (played a lot) and a shortcut of a game that was deleted.
await page.evaluate(async (ff7) => {
  const apps = window.SteamClient.Apps;
  const dup = await apps.AddShortcut("Final Fantasy VII (SRM)", ff7.exe, "", ff7.options);
  window.steamMockShortcuts.get(dup).minutes_playtime_forever = 900;
  await apps.AddShortcut("Gone Game", '"/home/deck/Emulation/tools/launchers/duckstation.sh"', "", '-batch "/home/deck/EmuDecky/roms/psx/Gone Game.chd"');
  await apps.AddShortcut("Some Steam game", '"/usr/bin/flatpak"', "", "run com.example.Game");
}, ff7);

// Emu Hub switches PS1 to RetroArch and says so.
await page.evaluate(() => {
  window.__mockLaunch = { psx: ['"/home/deck/Emulation/tools/launchers/retroarch.sh"', "-L .../swanstation_libretro.so", "PS1"] };
  window.dispatchEvent(new CustomEvent("emuhub:emulator-choice", { detail: { console: "psx", emulator: "RetroArch" } }));
});
await page.waitForTimeout(800);
list = await shortcuts();
const moved = list.filter((s) => s.exe.includes("retroarch.sh") && s.options.includes("swanstation"));
console.log("re-pointed to RetroArch:", moved.map((s) => s.name));
if (moved.length !== 1) fail(`expected 1 re-pointed PS1 shortcut, got ${moved.length}`);

// Remove duplicates: first press asks, second runs.
await page.locator("button", { hasText: "Remove duplicates" }).click();
await page.locator("text=Press again to go ahead").first().waitFor();
await page.locator("button", { hasText: "Remove them" }).click();
await page.locator("text=/duplicate deleted/").waitFor();
list = await shortcuts();
const ffLeft = list.filter((s) => s.options.includes("Final Fantasy VII"));
console.log("Final Fantasy VII shortcuts left:", ffLeft.map((s) => s.name));
if (ffLeft.length !== 1 || ffLeft[0].name !== "Final Fantasy VII (SRM)") fail("dedupe should keep the most played one");
if (!list.some((s) => s.name === "Gone Game")) fail("dedupe must not touch other shortcuts");

// Re-add all games: drops the dead shortcut, points the kept SRM one at RetroArch, leaves the Steam game.
await page.locator("button", { hasText: "Re-add all games" }).click();
await page.locator("button", { hasText: "Re-add them" }).click();
await page.locator("text=/removed|already in order|moved/").last().waitFor();
await page.waitForTimeout(300);
const outcome = await page.locator("text=/shortcut of deleted games removed|already in order/").first().textContent().catch(() => "");
list = await shortcuts();
console.log("after re-add:", list.map((s) => s.name), "|", outcome);
if (list.some((s) => s.name === "Gone Game")) fail("dead shortcut still there");
if (!list.some((s) => s.name === "Some Steam game")) fail("a shortcut outside the ROM library was removed");
const kept = list.find((s) => s.name === "Final Fantasy VII (SRM)");
if (!kept || !kept.exe.includes("retroarch.sh")) fail("kept shortcut was not pointed at the chosen emulator");
await page.screenshot({ path: path.join(here, "steamclean.png") });

console.log(`console errors: ${errors.length}`);
for (const e of errors) console.log("  " + e);
await browser.close();
process.exit(errors.length ? 1 : 0);
