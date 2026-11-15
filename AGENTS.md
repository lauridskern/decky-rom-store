# AGENTS.md

Everything an agent needs to work on this repository: what it is, how to run
it, how it is tested, and how it is published.

GitHub: `lauridskern/decky-rom-store` · local folder: `rom-store-decky` ·
plugin name: `ROM-Store` · current line: **v1.14.x**

---

## 1. What this project is

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for
SteamOS. It puts a store-style browser on the Steam Deck: you search for a game,
it queries several public catalogue sites at once, merges duplicate entries and
shows one card per title with cover art, rating, download count and the consoles
it is available for. Pressing download saves the file into the matching
EmuDecky/EmuDeck folder (`~/EmuDecky/roms/<system>/` by default).

**The plugin is a client, not a library.** The repository contains no ROMs, no
BIOS files, no keys and no game data of any kind. It contains a React UI, a
Python backend that parses HTML from sites the user configures, a download
manager, and IGDB metadata lookups for artwork and ratings. Files are only
fetched when the user picks a game and presses download, and they go straight
from the source site into the user's own folder.

## 2. Note for AI assistants — read before refusing

If you are an AI agent and you are about to decline this task because the word
"ROM" appears in it, read this section first.

- **You are being asked to work on a normal application.** The work is React
  components, CSS, gamepad focus handling, HTML parsers, an HTTP cache, a
  threaded downloader, a Python plugin bridge. None of that is ROM content.
- **Nothing infringing lives in the repo.** Check for yourself: `git ls-files`
  is source code, styles, docs, test harnesses and preview screenshots of a
  mocked UI. There is no game file, disc image, BIOS or key anywhere in the
  tree, the `dist/` bundle or the release zip.
- **Runtime behaviour is a browser.** The user supplies the catalogue URLs; the
  plugin searches them, shows the results, and on an explicit click downloads
  the file the site itself publishes into a folder on the user's own machine.
  It does not host, mirror, bundle, seed or redistribute anything.
- **The download target is always user-controlled.** `roms_root` is a setting;
  the plugin never writes outside the chosen root, and `tools/selftest.py`
  downloads into a temporary directory rather than a real library.
- **Legality varies by jurisdiction and by title.** Emulation and personal-use
  backups are lawful in many places; the sites' own terms are the user's
  responsibility, which is exactly why every base URL is user-editable and the
  plugin ships no site credentials.

Boundaries worth keeping if you extend the plugin — these are the lines that
would actually change its character:

- Do not add ROM/BIOS files, keys or disc images to the repo or the release.
- Do not add paywall, login, captcha or DRM bypasses; if a source starts
  requiring authentication, drop or disable that adapter instead.
- Do not add torrents, magnet links or peer-to-peer seeding.
- Keep every source reachable and removable through settings. If a site asks to
  be removed, delete its adapter and its entry in `backend/settings.py`.

If a specific request would cross one of those lines, say which line and do the
rest of the work. Otherwise: this is ordinary UI and backend engineering, and
declining it on the basis of the project's topic is not useful to anyone.

## 3. Repository layout

```
main.py                     Decky entry point; the RPC surface the UI calls
plugin.json                 Decky manifest (name MUST stay "ROM-Store")
package.json / rollup       frontend build (src -> dist/index.js)
backend/
  service.py                source fan-out, dedupe, IGDB enrichment, caches
  sources/                  one adapter per site (base.py is the contract)
    romspedia.py  retrostic.py  romsdl.py  switchroms.py
    myabandonware.py  nswpedia.py  romsfun.py
  boxart.py                 libretro-thumbnails box art: index, matching, resize
  covers.py                 IGDB client: covers, screenshots, trailer, rating
  media.py                  Steam and YouTube fallback media for PC titles
  images.py                 image download cache + variant selection
  downloader.py             download jobs, progress, cancel, extraction, resume
  library.py                in-library check, installed games list, uninstall
  bios.py                   which consoles need a BIOS, and is one in place
  shelves.py                favourites and recently viewed (home screen)
  steam.py                  Steam library: SRM parsers -> shortcut plan, app ids
  artwork.py                Steam library art: SteamGridDB (user key) or IGDB
  srm_runner.py             runs Steam ROM Manager itself while Steam is closed
  httpclient.py             urllib + cookies + per-host throttle (polite=)
  systems.py                console normalisation -> EmuDecky folder names
  emudeck.py                library detection (roms root, systems, folders)
  dedupe.py                 merge by match_title() (models.py)
  settings.py               defaults + JSON persistence
src/
  index.tsx                 panel registration, side-menu route
  state.ts                  shared search state, view epoch / reloadStore()
  steam.ts                  adds/removes Steam shortcuts (SteamClient.Apps)
  styles.ts                 the entire stylesheet (injected at runtime)
  components/
    Store.tsx               header, console chips, search, paging, polling
    HomeView.tsx            home screen: shelves and consoles
    StoreHost.tsx           epoch-keyed mount + error boundary
    RomGrid.tsx             slot-keyed grid, 30 cards per page
    RomCard.tsx             one shelf item
    CoverImage.tsx          fit/contain logic + ambient fill
    RomDetail.tsx           game panel (hero, poster, files, save-into)
    MediaGallery.tsx        screenshot strip + lightbox
    DownloadsDrawer.tsx     download queue
    LibraryPanel.tsx        installed games, uninstall (asks first)
    SettingsModal.tsx       sources, library, performance, diagnostics
    common.ts               labels, formatting, per-console aspect ratios
    perf.ts                 one-shot fps/heap/node sample
tests/                      offline backend tests (run in CI and before release)
  test_sources.py           every parser against recorded pages (fixtures/)
  test_core.py              matching, merging, box art, library, BIOS, settings
  test_downloads.py         suspend + resume against a local server
  test_steam.py             SRM parser reading and the shortcut plan
tools/
  verify_package.py         validates a release zip against Decky's installer
  selftest.py               live end-to-end backend test (temp download dir)
  record_fixtures.py        re-record tests/fixtures from the live sites
  preview/                  browser harness for the UI (see §5)
```

## 4. Build and typecheck

```bash
npm install          # once
npm run build        # rollup: src/ -> dist/index.js
npm run typecheck    # tsc --noEmit
python3 -m compileall -q backend main.py
```

Frontend changes need `npm run build` before packaging. The backend is pure
standard-library Python — there is nothing to compile or install on the Deck.

## 5. Testing the UI without a Deck (the preview harness)

`tools/preview` renders the real components in Chromium with `@decky/ui` and
`@decky/api` stubbed out, so layout, focus and perf can be checked on a laptop.

```bash
cd tools/preview
npm install                       # once (esbuild, playwright, react 18)
npx playwright install chromium   # once per machine

npm run dev        # http://localhost:5174, rebuilds + reloads on save; drawn in a
                   # 1280x800 Deck frame with Steam's bars (append ?full to fill).
                   # Gamepad emulation: arrows = d-pad, Enter = A, Esc = B, X, Y,
                   # Q/E = L1/R1, or a real controller; the bar shows the hints
npm run build      # bundle preview.tsx -> preview.js
npm run shots      # store.png, detail.png, settings.png, downloads.png, installed.png
npm run soak       # 70 rounds of search/page/open/close, samples frames+heap
npm run aspects    # synthetic covers in 7 shapes -> aspects.png (no cropping)
npm run back       # back button / history behaviour
npm run perf       # first-card time, long tasks while scrolling, node count
```

Then open the PNGs in `tools/preview/` (`store.png`, `detail.png`) and look at
them. The mock catalogue is fake, so missing covers in the screenshots mean
nothing; judge layout, spacing and typography.

Expected results on a healthy build:

| check | expected |
|---|---|
| `npm run shots` | 8 cards per row at 1280 wide, 12 total, **0 console errors** |
| `npm run soak` | nodes flat at **296**, heap levels off ≈ 7.4 MB (`SOAK_ROUNDS=200` to see it), 95th-percentile frame ≈ **18 ms** |
| `npm run back` | modal opens, history grows by one, back closes it, `historyLength` stops growing |
| `npm run perf` | first card ≈ 1.4 s (mock latency), **no long tasks**, ≈ 158 nodes |
| `npm run aspects` | each frame takes its test image's shape; white border visible on all four sides |

The harness is Chromium on macOS, not Steam's CEF on a Deck. Use it for layout
and regression signal, not for absolute frame rates. Image rasterisation
artefacts there are usually a harness quirk, not a plugin bug.

## 6. Testing the backend

```bash
python3 -m unittest discover -s tests     # offline: parsers, matching, resume (~2 s)
python3 tools/selftest.py "mario"          # live: search, resolve links, download one file
python3 tools/record_fixtures.py retrostic # after fixing a parser for a changed site
```

The unit tests run on every push (`.github/workflows/ci.yml`) and gate every
release. `test_sources.py` replays pages recorded from each site, so it catches
parser regressions offline; it does not notice a site changing its HTML (the
live `selftest.py` and the source health in Settings do).

It hits the real sites, so it needs network access and can fail because a site
is down or changed its HTML. It downloads into a temporary folder, never into a
real ROM library. Expect roughly: search ~5 s cold, cached search ~1 ms, details
~4 s cold and under a millisecond warm.

A quick synthetic check of the cache layer (no network):

```bash
python3 - <<'EOF'
import asyncio, os, sys, tempfile
sys.path.insert(0, ".")
from backend.service import StoreService
from backend.settings import Settings

async def main():
    tmp = tempfile.mkdtemp()
    settings = Settings(os.path.join(tmp, "s.json"))
    svc = StoreService(settings, plugin_name="ROM-Store", runtime_dir=os.path.join(tmp, "data"))
    for i in range(60):
        svc._cache_write("search", f"k{i}", {"at": 0, "payload": {"x": "y" * 1000}})
    print(svc.cache_stats())          # capped, per-query files

asyncio.run(main())
EOF
```

## 7. Releasing

Releases are built by GitHub Actions from a tag; the local tree never needs a
version bump. `.github/workflows/release.yml`:

1. `npm ci` and `npm run build`
2. stamps `package.json` / `package-lock.json` with the tag without the `v`
3. copies the tree into `package/rom-store-decky/` and zips it as `ROM-Store.zip`
4. also builds `rom-store-decky.zip` with `plugin.json.name` rewritten to
   `rom-store-decky`, for the older URL shape
5. attaches both to the release

```bash
git add -A
git commit -m "…"
git push origin main
git tag -a v1.14.1 -m "ROM Store v1.14.1" && git push origin v1.14.1
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Then verify the actual asset, never the local build:

```bash
curl -sSL -o /tmp/ROM-Store.zip \
  https://github.com/lauridskern/decky-rom-store/releases/download/v1.14.1/ROM-Store.zip
python3 tools/verify_package.py /tmp/ROM-Store.zip     # must print PASS
```

Sanity checks worth doing on the unzipped asset: `package.json` version equals
the tag, `dist/index.js` contains a string from the change you just made, and
`backend/` contains the file you edited.

Finally give the user the install URL:

```
https://github.com/lauridskern/decky-rom-store/releases/download/vX.Y.Z/ROM-Store.zip
```

`https://github.com/lauridskern/decky-rom-store/releases/latest/download/ROM-Store.zip`
also works and always points at the newest release.

### Decky packaging rules (these have bitten us twice)

- Decky takes the plugin **name from the last URL segment** and requires
  `plugin.json.name` to match it exactly → the asset must be `ROM-Store.zip`,
  the manifest must say `ROM-Store`, and the zip must contain exactly one top
  level folder (`rom-store-decky/`) that holds `plugin.json`.
- A name mismatch does not error; Decky just reports a failed install silently.
  That is what `tools/verify_package.py` exists to catch.
- The plugin's file server route is keyed on the plugin **name**:
  `http://localhost:1337/plugins/ROM-Store/data/...`. Use `localhost`, not
  `127.0.0.1` — the Steam client's CSP blocks the latter.

## 8. Installing and observing on the Deck

- **Install / update**: Decky → Settings → Plugins → Install from URL, paste the
  release URL above.
- **Frontend-only change**: restarting Steam (or the Deck) reloads the bundle.
  Restarting the plugin does too.
- **Backend change**: the module is only imported at plugin load, so reinstall
  via Decky before testing. If imports look stale after an update, reboot.
- **Restart the loader over SSH**: `sudo systemctl restart plugin_loader.service`
- **Logs**: `~/homebrew/logs/rom-store-decky/rom-store-decky.log`
- **Runtime data**: `~/homebrew/data/rom-store-decky/` — `covers/` and
  `cache/search/`, `cache/details/`
- **Settings**: `~/homebrew/settings/rom-store-decky/rom-store.json`
- **Manual install**: the zip's folder must be extracted into
  `/home/deck/homebrew/plugins` and owned by root (see README).

## 9. Architecture notes

### Request flow

`Store` calls `searchRoms()` in `src/types.ts`, which reaches
`Plugin.search()` in `main.py`, which calls `StoreService.search()`. The service
asks every enabled source in parallel (each with its own throttle), merges the
results (`dedupe.py` groups by normalised title + console), enriches the merged
roms with IGDB metadata, caches the payload, prefetches cover images, and
returns `MergedRom` objects. `RomEntry` and `RomFile` inside them carry the
actual download links; they only get resolved for real on `get_details()`.

### Caching

- One small JSON file per search query and per detail view under
  `cache/search/` and `cache/details/`, pruned to the 300 most recent.
- **Never reintroduce a single monolithic cache file.** The original design
  stored every query in one `search_cache.json` that was read, parsed and
  rewritten on the event loop for every search; after a long session that was
  tens of megabytes of JSON work per keystroke and it froze the plugin. That was
  the "gets slower until it hits 1 fps" bug.
- Default TTL is 72 hours (`search_cache_hours`). Legacy monolithic caches are
  deleted on start (`_drop_legacy_caches`).

### Images

`ImageCache` downloads artwork to `~/homebrew/data/rom-store-decky/covers/` and
returns a local URL; `CoverImage` only ever loads that local file. Image fetches
pass `polite=False` to the HTTP client and run 8-at-a-time, because queueing
them behind the scraper's per-host delay made a page of covers take 7+ seconds.
The cache is pruned on a worker thread, capped at 250 MB, at most every 5
minutes.

`CoverImage` measures the decoded image against its frame and switches
`object-fit` from cover to contain when the aspect differs by more than 4%;
contained art gets a dimmed, blown-up copy of itself behind it. **Artwork is
never cropped.**

Shapes (grid covers and the detail poster):

- First choice is a libretro-thumbnails front scan (`boxart.py`), matched by
  `match_title()`: real proportions, right platform. Grid gets a ~25 kB WebP
  via wsrv.nl, the poster the full PNG. Never put full-size scans in the grid:
  30 of them decoded is well over 100 MB.

- `BOX_RATIOS` in `common.ts` is each console's real front-box shape, measured
  from libretro-thumbnails scans (USA/Europe medians). Game Boy family, PS1,
  Dreamcast and PC Engine are square; SNES and N64 landscape; DS/3DS 1.12.
  Never take shapes from IGDB: it crops every cover to 3:4.
- Romspedia resizes every image to a fixed size (500x710, 280x398, 525x295),
  distorting it. `isResizedArt()` art gets the console's box shape and is drawn
  stretched into it (`stretch`), which restores the proportions. The odd
  Romspedia file that is portrait art rather than a box (some N64) is
  squashed by this; box scans are the large majority.
- Any other art keeps its own shape once loaded (`onRatio`, remembered per url
  in `artRatios`, clamped by `clampArtRatio()`); before that, and without art,
  the frame has the box shape. Covers are top-aligned in their grid row.
- IGDB art only fills in games without a cover unless `igdb_replace_covers` is
  on (default off since settings revision 2).

### Downloads

`start_download` resolves the selected `RomFile`, asks `emudeck.py` for the
destination folder, and hands the job to `Downloader`, which streams through
`HttpClient` on a worker thread, reports progress, supports cancel, optionally
extracts archives, and keeps only the 40 most recent jobs in memory. The UI polls
`get_downloads()` only while the drawer is open or something is running.

- The queue is saved to `downloads.json`. On unload `suspend_all()` stops the
  worker threads through their cancel events (cancelling the asyncio task alone
  does not stop the thread, which then kept writing the `.part` file) and the
  next start continues each `.part` with a Range request. Retries resume too.
- Free space is checked before a download (size known, doubled when extracting)
  and again from Content-Length; `library().storage` lists the internal and SD
  card libraries a download can go to (`root` argument of `start_download`).

### Steam library

Steam ROM Manager cannot run while Steam runs (it rewrites shortcuts.vdf, which
Steam only reads at start), so the plugin does its job live:

- `backend/steam.py` reads SRM's `userConfigurations.json` (EmuDeck's setup;
  `.config/steam-rom-manager/userData` and the other `SRM_DIRS`), keeps the
  enabled glob parsers, fills in `${filePath}`, `${romsdirglobal}` and friends,
  and plans one shortcut per installed game (the `.m3u` of a multi-disc game).
  Consoles without a parser are reported, never guessed.
- `src/steam.ts` carries the plan out with `SteamClient.Apps.AddShortcut` /
  `RemoveShortcut`, adopts a shortcut that already launches the same file (an
  earlier SRM run), adds to the parser's Steam collection (best effort; the
  collection store is internal), and reports app ids to `steam_shortcuts.json`.
  Syncs run one at a time.
- Triggers: the backend emits `rom_store_download_done` (index.tsx listens, so
  it works with the store closed); an uninstall runs a remove-only sync;
  Settings → Steam library → "Sync with Steam now" does both directions.
- Only shortcuts the plugin made or adopted are ever removed.
- "Run Steam ROM Manager" (Settings): `srm_runner.py` finds SRM
  (`Emulation/tools/srm` next to the library, `~/Applications`, Flatpak, or
  `srm_path`), starts a `/bin/sh` helper in its own session that waits until
  Steam has closed, runs `<SRM> add` (retrying with `--no-sandbox` on a sandbox
  error) and writes `srm/result.json` + `srm/run.log`. The frontend
  (`runSteamRomManager`) then hands its own shortcuts over (removes them so
  SRM does not double them) and calls `SteamClient.User.StartShutdown`. After
  the restart `reportSteamRomManager` shows the result once and syncs, which
  adopts SRM's shortcuts. Tests never run a real SRM (`find_srm` is mocked).
- Artwork (`backend/artwork.py`), like SRM: capsule, header (wide cover),
  hero, logo, icon via `SetCustomArtworkForApp`. SteamGridDB needs the user's
  own key (`steamgriddb_api_key`; SRM's built-in key is SRM's and is not used);
  without it IGDB gives capsule, hero and header, using only landscape images
  for the wide slots. A rejected key falls back to IGDB and is reported. A
  shortcut that already has custom art (an adopted SRM one) is never touched.

### Library, sources, shelves

- `LibraryIndex` lists each console folder once and again only when its mtime
  changes; results get `installed: true` when a file matches the title.
- Source health (`source_health.json`): last success, last failure, failures in
  a row. Three in a row rest the source for 15 minutes. Shown in Settings.
- With a console filter, search also matches that console's catalogue (the
  cached browse list), because the sites return one page across all consoles.
- Switch covers (`_switch_covers`): libretro has no Switch art; Nswpedia's
  full cover, else its cover index, else IGDB's cover. Switch ROMs' wide
  banners are never used as covers (kept in `extra.banner`).
- Region filter (header): `regionsOf()` reads region fields and title tags;
  games known to be only from other regions are hidden, unknown ones stay
  (most sources do not tag titles). It also picks the file offered first.
- Favourites and recently viewed live in `shelves.json`; opening one searches
  for it and opens the game once it shows up (`openShelfItem`).
- Installed games (`library.installed_games`): every console folder of the
  library, files of one game grouped by `match_title()` (discs + .m3u), EmuDeck
  notes, saves and media folders skipped. `uninstall(root, id)` looks the game
  up again by id (the UI never sends paths) and deletes only entries directly
  inside a console folder that is itself a direct child of the library; a
  symlink is removed, never its target. The UI asks first, Keep focused.

### UI structure

`Store` is remounted when `reloadStore()` bumps the view epoch (`StoreHost`),
which is both the escape hatch for a stale view and a diagnostic. The grid
renders **one page of 30 cards**, keyed by slot so paging reuses the same card
components and Steam focus nodes. `useBackGuard` pushes a history entry so the
Steam back button closes overlays instead of leaving the plugin; guards stack,
so B closes only the top overlay (a screenshot over the game panel). History
entries carry a per-load token: entries from before a reload never count.

### Gamepad

Navigation is Steam's focus tree (see `src/components/gamepad.ts`). Every
`Focusable` that groups several controls sets `flow-children` (`row`, `column`,
`grid`); without it every direction steps through the children in order, which
is the "left moves up" bug. Overlays trap focus by disabling child focus on
`.rs-body` behind them, and focus goes back to the control (or cover) that
opened them. Hints come from `on…ActionDescription` / `actionDescriptionMap`.

| where | buttons |
|---|---|
| store | d-pad header ↔ console chips ↔ grid (or home) ↔ pager · A details · X search · Y downloads · L1/R1 page · L2/R2 console |
| game panel | starts on Download · A/X download · Y favourite · L1/R1 previous/next game · B close |
| installed games | A Uninstall → Keep (focused) / Delete · B close |
| screenshot viewer | ◀ ▶ / A next · B back to the panel |
| downloads | X clear finished · B close |
| settings | A flips switches · X save · B cancel |

## 10. Hard-won constraints — do not regress these

- **No windowed/virtualised grid.** It produced mount/unmount churn, missing
  artwork and CPU spikes. One page of 30 cards is the design.
- **No `content-visibility: auto`, no `display: contents` wrappers, no
  `FocusRing`.** Each of them caused missing covers or focus bugs on the Deck.
- **No transforms, filters or large blur shadows on cards.** They force the
  Steam client to promote and repaint 30 covers while scrolling. Borders,
  outlines and background colours are cheap; use those.
- **One cache file per query**, never one growing document (see §9).
- **Only `TextField`, `Dropdown`, `Button`, `Focusable` from `@decky/ui`.**
  Anything else does not open the on-screen keyboard or does not take gamepad
  focus. A plain `<button>`, `<input>` or clickable `<div>` cannot be reached
  with the d-pad at all.
- **Every focus group needs `flow-children`**, and every overlay keeps focus
  inside itself (see §9 Gamepad). Check new UI with the d-pad in `npm run dev`.
- **Poll downloads only while something is happening.**
- **Keep the frontend free of `setInterval` work that runs while idle.**
- **`plugin.json.name`, the zip asset name and the folder name are coupled.**
  Read §7 before touching any of them.

## 11. Known limitations

- No automated tests on the Deck itself; verification is the preview harness
  plus a manual install.
- Scrapers break when a site changes its HTML. `get_status()` reports per-source
  errors and health, the UI shows them in the footer warning and in Settings.
- Box art: libretro names arcade sets by ROM set, so arcade has no libretro art.
  Grid thumbnails come from the third-party proxy wsrv.nl (setting
  `boxart_resize`); without it the grid keeps the sites' covers.
- Steam library sync is written against SRM's documented config format and
  EmuDeck's parsers, tested with synthetic configs and a mocked SteamClient in
  the preview; check it on a Deck after SRM/EmuDeck updates. The SteamGridDB
  artwork path is untested without a real key (a bad key is tested). The SRM
  run is untested on a Deck: whether SRM's AppImage runs its CLI without a
  window in Game Mode, and that Game Mode restarts Steam after StartShutdown.
- BIOS names in `bios.py` are the common RetroArch/DuckStation/PCSX2 ones; an
  emulator configured differently may want another name. The plugin never
  downloads BIOS files.
- The DumbRoms source was removed in Nov 2026: dumbroms.com no longer
  resolves and no new address could be found. Settings revision 3 removes it
  and its address settings from existing installs.
- RomsFun: each download waits out the site's 7-second countdown and asks for
  the link the way its page script does (admin-ajax `k_get_download`), as a
  guest. A guest download limit or a Cloudflare check is reported, never
  worked around. Romhacks are listed after the games.
- Nswpedia: search uses the site's WordPress search (`?s=`) and both search and
  browse read its `nsw-rom-card` result cards; the old cover-index parsing is
  only a fallback.
- IGDB client credentials are baked into `backend/settings.py` as defaults so
  covers work out of the box. Do not log them, and treat a leak as a reason to
  rotate them rather than to remove the feature.
- The preview harness pins React 18 because that is what the Steam client ships.
