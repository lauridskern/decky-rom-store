# AGENTS.md

Everything an agent needs to work on this repository: what it is, how to run
it, how it is tested, and how it is published.

GitHub: `uposum/decky-rom-store` · local folder: `rom-store-decky` ·
plugin name: `ROM-Store` · current line: **v1.16.x**

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
  responsibility, which is exactly why the plugin ships no site addresses
  (the user enters each one) and no site credentials.

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
    myabandonware.py  romsfun.py  homebrewhub.py
  boxart.py                 libretro-thumbnails box art: index, matching, resize
  gametdb.py                GameTDB box art (Switch, and what libretro lacks for
                            Wii U, PS3, Wii, DS, 3DS): title lists, regions
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
  speeds.py                 measured speed + start delay per source (ranking)
  speedtest.py              speed test: one real link per source, timed sample
  mods.py                   mods for installed games: GameBanana, emulators, install
  titles.py                 real names for files; Switch title IDs by name
  unpack.py                 unpacking archives the console's emulator cannot open
  data/switch_titles.json.gz  Switch title ID -> name (tools/update_switch_titles.py)
  data/gametdb_switch_retail.json.gz  GameTDB IDs of retail Switch games (same tool)
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
    Store.tsx               the shell: top bar (tabs, search), results, paging,
                            info strip, polling, what B / L1 / R1 / L2 / R2 do
    HomeView.tsx            home screen: shelves, consoles
    StoreHost.tsx           epoch-keyed mount + error boundary
    RomGrid.tsx             slot-keyed grid, 30 cards per page
    RomCard.tsx             one cover; NoArt, the tile for a game without art
    CoverImage.tsx          fit/contain logic + ambient fill; useCoverSrc
    GamePage.tsx            full-screen game page (poster, download, versions,
                            media, save-into)
    MediaGallery.tsx        screenshot strip + lightbox
    LibraryView.tsx         Library tab: installed games, drives, uninstall
    ModsPanel.tsx           a library game's page: popular mods, install/remove
    DownloadsView.tsx       Downloads tab: running and finished downloads
    SettingsView.tsx        Settings tab: section list + pane, saves by itself
    ui.tsx                  shared parts: Glyph, Switch, Progress, EmptyState
    useBackGuard.ts         the B button (history entries, see §9 UI structure)
    gamepad.ts              pad constants, focus helpers
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
  update_switch_titles.py   rebuild backend/data/switch_titles.json.gz from titledb
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
npm run shots      # walks the store with the pad (keys), checks where focus lands,
                   # writes home.png, store.png, detail.png, library.png,
                   # downloads.png, settings.png; exits 1 on a failed step
npm run soak       # 70 rounds of search/page/open/close/tabs, samples frames+heap
npm run aspects    # synthetic covers in 7 shapes -> aspects.png (no cropping)
npm run back       # back button / history behaviour
npm run perf       # first-card time, long tasks while scrolling, node count
npm run readme     # the README screenshots -> docs/screenshots/*.jpg (needs network)
```

`npm run readme` draws the store with `showcase.json` (`__SHOWCASE` in
`mock-api.ts`): real games with the cover links the store itself would use,
on a 1:1 Deck screen at 2x. `python3 tools/preview/showcase.py` rebuilds that
file from libretro, GameTDB and IGDB. `docs/` is left out of the release zip.

Then open the PNGs in `tools/preview/` (`home.png`, `store.png`, `detail.png`)
and look at them. The mock catalogue is fake, so missing covers in the screenshots mean
nothing; judge layout, spacing and typography.

Expected results on a healthy build:

| check | expected |
|---|---|
| `npm run shots` | every step `ok`, `failures: none`, 8 cards per row at 1280 wide, 12 total, **0 console errors** |
| `npm run soak` | nodes flat at **272**, heap levels off ≈ 7.4 MB (`SOAK_ROUNDS=200` to see it), 95th-percentile frame ≈ **18 ms** |
| `npm run back` | game page opens, history grows by one, back closes it, back again shows the home screen, `historyLength` never grows past that |
| `npm run perf` | first card ≈ 1.4 s (mock latency), **no long tasks**, ≈ 174 nodes (the preview's console `<select>` has an `<option>` per console) |
| `npm run aspects` | each frame takes its test image's shape; white border visible on all four sides |

In these scripts wait for elements with `locator(...).waitFor()`, not
`page.waitForSelector()`: the latter returns a handle, and a handle kept per
round pins every grid that has been replaced since (the grid is rebuilt for
each search). That reads as a leak of the store; it is a leak of the test.

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
4. checks it with `tools/verify_package.py` and attaches it to the release

There is **one** asset. Until v1.18.3 a second `rom-store-decky.zip` was
built for an older URL by rewriting `plugin.json.name` after the build. That
never worked: `@decky/rollup` writes plugin.json's name into
`dist/index.js` (`const manifest = {"name":"ROM-Store"}`) and the page asks
Decky for that plugin's backend, so the renamed copy loaded a page whose
every call hung (Settings and the tabs loading forever). Never rename a
built package; `verify_package.py` now fails when the two names differ, and
Plugin-Hub refuses such a zip.

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
  https://github.com/uposum/decky-rom-store/releases/download/v1.14.1/ROM-Store.zip
python3 tools/verify_package.py /tmp/ROM-Store.zip     # must print PASS
```

Sanity checks worth doing on the unzipped asset: `package.json` version equals
the tag, `dist/index.js` contains a string from the change you just made, and
`backend/` contains the file you edited.

Finally give the user the install URL:

```
https://github.com/uposum/decky-rom-store/releases/download/vX.Y.Z/ROM-Store.zip
```

`https://github.com/uposum/decky-rom-store/releases/latest/download/ROM-Store.zip`
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
  30 of them decoded is well over 100 MB. libretro keeps a duplicate name as
  a git symlink that the server hands out as a 19-byte text file, not an
  image; `scan_names()` leaves entries under 1 KB out of the index (Atari
  Lynx had a third of its covers broken by them; `INDEX_VERSION` rebuilds
  old indexes once).
- `ImageCache` only keeps what starts like an image (`_looks_like_image`):
  an error page or a link file is a failed cover, never a cached one. A
  cover that fails to load shows the title tile (`CoverImage` `fallback`,
  `NoArt`), not an empty frame.

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
`get_downloads()` only while the Downloads tab is open or something is running.
A job carries the game's `cover` for that tab.

- The queue is saved to `downloads.json`. On unload `suspend_all()` stops the
  worker threads through their cancel events (cancelling the asyncio task alone
  does not stop the thread, which then kept writing the `.part` file) and the
  next start continues each `.part` with a Range request. Retries resume too.
- Unpacking (`unpack.py`): a download is unpacked when the user asks
  (`extract_archives`, `keep_archive`) and always when the console's emulator
  cannot open that archive type: the EmuDeck parsers for the folder list the
  types (PPSSPP takes .7z but not .zip; DuckStation and Dolphin take none),
  else `DISC_SYSTEMS`. A forced unpack deletes the archive. ZIP in Python,
  7z/RAR with `bsdtar`, flattened into the console folder, never overwriting,
  off the event loop. Games already on the Deck in such an archive are
  flagged `needs_unpack` in the Library and their page has an Unpack button
  (`unpack_game`), which also adds the game to Steam.
- Free space is checked before a download (size known, doubled when extracting)
  and again from Content-Length; `library().storage` lists the internal and SD
  card libraries a download can go to (`root` argument of `start_download`).

### Mods (Library → a game)

`backend/mods.py`, `src/components/ModsPanel.tsx`. Switch (Ryujinx; yuzu,
Citron, Eden, Sudachi, suyu) and GameCube / Wii (Dolphin) so far.

- Emulators are found by their data folders (`EMULATORS`: EmuDeck's places,
  native and Flatpak); a mod goes into every one found for that console.
  Ryujinx: `mods/contents/<title id lower>/<mod>/`; the yuzu family:
  `load/<TITLE ID>/<mod>/`; Dolphin: `Load/Textures/<game id>/<mod>/`, and
  "Load Custom Textures" (`GFX.ini` `[Settings] HiresTextures = True`) is
  switched on, the rest of the file kept.
- Game IDs: Switch from `[0100…]` in the file name, else the ticket name
  inside an NSP (PFS0), else by name (`titles.py`): the shipped title list
  (`backend/data/switch_titles.json.gz`, ~19k base games, 330 kB, made from
  blawar/titledb's 90 MB US.en.json by `tools/update_switch_titles.py`; run
  it before a release now and then), then Ryujinx's game list
  (`games/<tid>/gui/metadata.json`). The NCA metadata is encrypted and is
  never read. An update's ID maps to the base game (`…000`).
- Names: `installed_view` gives every game a `name`: Switch from the title
  list, others from the matched libretro scan or GameTDB, else
  `titles.clean_name()` (`+`/`%20`/`_` to spaces, tags and "NSP" gone,
  "Title, The" turned round). GameBanana is searched with it. The Library
  reads console folders strictly (`emudeck_folder(..., strict=True)`): a
  missing `nes` folder must not make SNES games NES games.
  GC / Wii: the disc header of ISO/GCM, RVZ/WIA (0x58), CISO, WBFS.
- GameBanana: the game by name (`Util/Game/NameMatch` matches a continuous
  piece of a name, so `name_queries()` asks with pieces of the title and only
  the same `match_title()` is accepted), its most downloaded mods
  (`Mod/Index`), their files, and the paths inside each archive from the
  legacy API (`Metadata().aArchiveFilesList()`), without downloading. Mod
  lists are cached a day, games two weeks, archive listings for good.
- `classify()`: Switch mods are the folders holding `romfs`/`exefs`/`cheats`
  (several = builds to pick); Dolphin mods are `tex1_*` texture packs, and
  anything that replaces disc files (`.arc`, `.szs`, `.dol`, `.xdelta`, …) is
  "not one-click". Unknown layouts are listed, not installable.
- Install: one at a time, download (progress, cancel), unpack (ZIP in
  Python; 7z/RAR with `bsdtar`; paths outside the archive are refused), copy
  the chosen build, record every path in `mods/installed.json`. Remove deletes
  exactly those paths, and only when they sit directly in that emulator's mod
  folder for the game.
- Untested on a Deck: the emulator folders are EmuDeck's standard ones and
  `bsdtar` is assumed to be on SteamOS. Mods made for another game update
  can crash a Switch game; the version GameBanana lists is shown.

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
- Only shortcuts the plugin made or adopted are ever removed by a sync.
- Every sync re-points the shortcuts the plugin manages whose launch command
  no longer matches SRM's parsers (exe, start dir, launch options, in place
  with `SetShortcutExe` & co.), so a change of emulator reaches them.
  Emu Hub (`../decky-emu-hub`) switches the parsers from its "Which emulator
  opens games" setting and dispatches the DOM event `emuhub:emulator-choice`
  (`{ console, emulator }`) on `window`; `index.tsx` listens and syncs. Both
  plugins live in Steam's page, so neither needs the other installed. Keep
  the event name in step with Emu Hub's `src/choice.ts`.
- Settings → Steam has two clean-ups, each asking first:
  "Remove duplicates" keeps one shortcut per game (most played, else the
  plugin's own, else the oldest) and deletes the others, SRM's included;
  "Re-add all games" also deletes shortcuts whose ROM file is gone (only
  files inside a console folder of the library, `steam.gone()`, so other
  non-Steam games are never judged), re-points every game and adds the
  missing ones. Nothing is deleted and made again: play time, artwork and
  collections stay. `npm run steamclean` (preview, `?plugin`) walks both
  and the emulator-choice event against the SteamClient mock.
- Play (a Library game's page, `playGame` in `src/steam.ts`) starts the game
  through its Steam shortcut with `SteamClient.Apps.RunGame` (the shortcut's
  64-bit game id: `m_gameid`, else app id << 32 | 0x02000000). A game without
  one gets it first from the same sync a download runs; a console without an
  SRM parser cannot be started and says so. Hidden while a game needs
  unpacking. Untested on a Deck.
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
  hero, logo, icon via `SetCustomArtworkForApp`. SteamGridDB with the user's
  own key (`steamgriddb_api_key`) or the store's built-in one (SRM's built-in
  key is SRM's and is not used);
  without it IGDB gives capsule, hero and header, using only landscape images
  for the wide slots. A rejected key falls back to IGDB and is reported. A
  shortcut that already has custom art (an adopted SRM one) is never touched.

### Library, sources, shelves

- **Sources ship without addresses** (settings revision 7). The plugin has a
  reader per site, named in Settings → Sources, and the user enters where
  each site is; `build_sources()` skips a source with no address, so a new
  install searches nothing until one is set up. The home screen then shows
  "Add a source to get started" (`HomeView` `onSetup`, which opens Settings
  on Sources), and the speed section stays hidden. Installs from before
  revision 7 keep the addresses they had (`_LEGACY_ADDRESSES`: by migration,
  or `keep_addresses()` when there was runtime data but no settings file; a
  new install writes its settings file at once so it is never taken for an
  old one). The search cache is keyed by the sources asked and their
  addresses. The README names no sites and its screenshots show one neutral
  "My source" (`SHOW_SOURCE` in `mock-api.ts`); keep it that way.
  `tools/selftest.py` fills in each reader's own `homepage` from `SOURCE_DEFS`.

- `LibraryIndex` lists each console folder once and again only when its mtime
  changes; results get `installed: true` when a file matches the title.
- Source health (`source_health.json`): last success, last failure, failures in
  a row. Three in a row rest the source for 15 minutes. Shown in Settings.
- With a console filter, search also matches that console's catalogue (the
  cached browse list), because the sites return one page across all consoles.
- Box art order: libretro-thumbnails (`boxart.py`, about 60 consoles incl.
  FBNeo and MAME arcade, which libretro names by full title); for the games
  of GameTDB's consoles (`gametdb.PLATFORMS`: Wii U, PS3, Wii, DS, 3DS) that
  libretro has no scan for, GameTDB (`_apply_boxart`); then the site's cover;
  then SteamGridDB (`sgdb.py`) for games still without a cover; then IGDB.
  Switch (`_switch_covers`): GameTDB first (retail games only: for an
  eShop-only game GameTDB's cover is an orange "Nintendo eShop" stand-in;
  `data/gametdb_switch_retail.json.gz`), libretro has none. Cached search
  and detail results are dropped once when `StoreService.CACHE_REVISION`
  changes, so a change to the cover rules shows at once.
- SteamGridDB covers (`sgdb.py`): autocomplete search on the cleaned title,
  accepted only when SteamGridDB's name is the same title (`match_title`) or
  the start of it (10+ characters); the top static 600x900 grid (`thumb` for
  the grid, `url` for the poster). Answers, found or not, are kept two weeks
  in `sgdb_covers.json`; network or key errors are never recorded. A search or
  browse waits 3 s for up to 32 new titles (4 at a time) and leaves the rest
  for the next one. Used in search (`_enrich_covers`), browse
  (`_fill_missing_covers`), Switch (`_switch_covers`) and the library. Key:
  the user's `steamgriddb_api_key`, else `DEFAULT_STEAMGRIDDB_KEY` in
  `settings.py` (the maintainer's free key, baked in on purpose like the IGDB
  credentials: never log it; rotate it if it is abused).
- GameTDB (`gametdb.py`): title lists (`<platform>tdb.txt`, two weeks;
  Switch's fetched at plugin start, the others when their console first
  shows up), matched by `match_title()`, then with the catalogues' noise
  removed ("Download … NSP Full Game"), then as a cut-off title (the shortest
  full title it starts, keys of 12+ characters). Nothing waits on the art
  server: a game whose cover region is known gets it, one not looked up yet
  gets its likeliest region at once and `ImageCache.alternatives` tries the
  other regions if that file is missing, while a background lookup
  (48 per search, 6 at a time) records the real region in
  `gametdb/covers.json` (none: asked again after a week; network errors are
  never recorded). Art and lookups go through wsrv.nl when `boxart_resize`
  is on (the default): art.gametdb.com throttles and then stops answering a
  client that asks for many covers, which left a third of the Switch grid
  blank; the lookup is an 8x8 request. Three timeouts in a row pause the
  lookups for 30 minutes. A missing title list is waited for 10 s in all
  (`LIST_WAIT`, shared by every search while it is fetched); one that could
  not be fetched is not asked for again for 30 minutes (`LIST_RETRY`). Grid: `cover`, poster: `coverM` (Wii: `cover`
  only, PNG).
  Switch ROMs' wide banners are never used as covers (`extra.banner`).
  Installed games get the same art.
- Firmware is never a result: `dedupe.is_firmware()` drops "[BIOS] …"
  entries (Retrostic lists them per console) and the Atari ST's "TOS v…"
  in `merge_entries`, so search, browse and the console pages all skip them.
- Switch ROMs titles carry the site's noise ("Download … Switch (NSP/XCI)",
  "& Update", "Latest", "Full Game"); `SwitchRomsSource._clean_title` strips
  it, so the titles match GameTDB, SteamGridDB and the other sources.
- Region filter (header): `regionsOf()` reads region fields and title tags;
  games known to be only from other regions are hidden, unknown ones stay
  (most sources do not tag titles). It also picks the file offered first.
- Provider speed (`speeds.py`, `source_speeds.json`): each finished download
  (2 MB or more) records bytes over transfer time (resumed bytes excluded)
  and the start delay (resolving the link: forms, RomsFun's countdown) as a
  moving average per source. The speed test (`speedtest.py`; Settings →
  Sources → "Test all now", and by itself weekly from the background ticker
  when `speed_test_auto` is on and nothing is downloading) measures every
  enabled source, one after the other: search a common title, resolve one
  real download link like a download does, read up to 8 MB / 6 s of it with
  `HttpClient.sample()` and discard it. One link per source per test (RomsFun
  counts guest downloads). A source whose last test got no file
  (`test_error`: a Cloudflare check, a file host's download page) is offered
  last. The game page orders files by preferred region (only if one is set),
  then by estimated time (delay + the game's median size / speed);
  unmeasured sources count as the median; within one source its own order
  stays.
- The downloader never saves a web page as a game: a link that answers with
  HTML (a file host's download page) or a Cloudflare check fails with a
  message that says so (`HttpClient._is_web_page`, `_blocked`).
- Favourites and recently viewed live in `shelves.json`; opening one searches
  for it and opens the game once it shows up (`openShelfItem`).
- Installed games (`library.installed_games`; art added by
  `service.installed_view`: the libretro index by file name, else the cover a
  download of the game had, else IGDB (cached; uncached titles are looked up
  in the background, so they have art the next time)): every
  console folder of the library, files of one game grouped by `match_title()` (discs + .m3u), EmuDeck
  notes, saves and media folders skipped. Emulator storage is not a game
  either: links to folders (Vita3K's `InstalledGames`), known emulator
  folders (`mlc01`, Cemu's `roms`, `nand`, `keys`, `updates`, ...; see
  `_EMULATOR_FOLDERS`), and anything under 1 KB of game data. `uninstall(root, id)` looks the game
  up again by id (the UI never sends paths) and deletes only entries directly
  inside a console folder that is itself a direct child of the library; a
  symlink is removed, never its target. The UI asks first, Keep focused.

### UI structure

One screen, four tabs (`Store.tsx` is the shell):

- **Top bar**: brand, the tabs between `L1`/`R1` glyphs (Downloads carries the
  number of running downloads and a progress line), the search field.
- **Store tab**: the home screen (`HomeView`: shelves for recently viewed /
  favourites / installed games, then every console: `get_consoles` lists each
  console an enabled source can browse (`Source.browse_systems()`), the
  most played first (`POPULAR_CONSOLES`); no game counts, the sites publish
  none that mean anything after merging)
  while there is no query and no console; otherwise the results: a filter bar
  (console, region, source, sort), the grid, the pager, and the **info strip**
  under the grid that names the focused cover (covers carry no title). The
  strip keeps its own state behind a ref, so moving focus re-renders it, not
  the store.
- **Library / Downloads / Settings tabs**: `LibraryView`, `DownloadsView`,
  `SettingsView`. They are mounted only while open. The Store tab stays
  mounted behind them (`.rs-view.is-hidden`: `visibility: hidden` plus child
  focus off), so its covers, scroll position and focus survive a tab switch.
- **Game page** (`GamePage`): covers the whole store, top bar included. A game
  from a shelf opens at once from the title and cover the shelf has (a stub
  rom, id `stub:…`) while `openShelfItem` looks its links up in the
  background, without touching the search on screen. Starting a download
  keeps the page open; its button becomes that job's progress.
  The poster has its art's shape and fills the left column; on a screen too
  short for it the whole column narrows instead (`sideLayout`, measured from
  the page height), and only the facts that fit under it are shown.
- **Settings save by themselves** (`SettingsView`: 700 ms after the last
  change, and when the tab closes). There is no Save button.

`Store` is remounted when `reloadStore()` bumps the view epoch (`StoreHost`),
which is both the escape hatch for a stale view and a diagnostic. The grid
renders **one page of 30 cards**, keyed by slot so paging reuses the same card
components and Steam focus nodes.

**The B button** is `useBackGuard(open, onClose)`: it pushes a history entry
while something is open, so Steam's back navigation pops that entry and the
plugin closes the thing instead of being left. The steps, bottom to top: a
result list (`!home` → `goHome`), a tab other than Store (→ Store), the game
page, a screenshot, the uninstall question. Guards stack, so B closes only the
top one. Three details that matter:

- Entries carry a per-load token: entries from before a reload never count.
- A guard that closes without B (the X, a tab switch) leaves a stale entry; it
  is popped as soon as it is on top (`sweep`).
- A guard that opens in the same moment another closes (the game page handing
  over to the Downloads tab) takes over the stale entry with `replaceState`
  instead of pushing: popping the old entry afterwards would close what just
  opened. Never call `history.back()` or `pushState` anywhere else.

### Gamepad

Navigation is Steam's focus tree (see `src/components/gamepad.ts`). Every
`Focusable` that groups several controls sets `flow-children` (`row`, `column`,
`grid`); without it every direction steps through the children in order, which
is the "left moves up" bug. The game page traps focus by disabling child focus
on `.rs-body` behind it, and focus goes back to the control (or cover) that
opened it. Switching tabs puts focus inside the tab (`Store.focusTab`: the
first game, the first download, the section list), and back in the Store on
the cover that had it. Hints come from `on…ActionDescription` /
`actionDescriptionMap`. Focus always looks the same: a white ring
(`.rs-f.is-focus`); blue means selected or the main action.

| where | buttons |
|---|---|
| anywhere (not on the game page) | L1/R1 previous/next tab · X search · B back one step |
| home | d-pad shelves ↔ consoles · A open · Y favourite (shelf tiles) |
| results | d-pad search ↔ filters ↔ grid ↔ pager · A game page · Y favourite · L2/R2 page · B home |
| game page | starts on Download · A/X download (A on a running one: Downloads tab) · Y favourite · L1/R1 previous/next game · B close |
| library | A game page: starts on Play, then mods (A install/remove, a build to pick if several; B closes) · X Uninstall → Keep (focused) / Delete · B keeps · Y store page |
| downloads | A cancel / open a finished game's page · X clear finished |
| settings | up/down section (the pane follows focus), right into it · A flips a switch |
| screenshot viewer | ◀ ▶ / A next · B back to the game page |

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
- **The Store tab stays mounted behind the other tabs; they mount on demand.**
  Unmounting the store on a tab switch decodes a page of covers again on the
  way back and loses scroll and focus. Hide it with `visibility`, never with
  `display: none` (the grid would lose its layout) or a transform.
- **B goes through `useBackGuard`.** Do not call `history.back()` or
  `pushState` elsewhere; two views swapping in one moment is the case it
  exists for (§9 UI structure).
- **Focus is one look everywhere** (white ring), and nothing smaller than 12px
  or shorter than 38px takes focus: it is read at arm's length on 1280x800.
  Steam's own focus ring is off: every `Focusable` and `Button` in the store
  says `noFocusRing`, and while focus is inside the store `Store.tsx` hides
  `focusRingClasses.FocusRing` for Steam's `Dropdown` / `TextField`, which
  take no such prop. A dropdown sits in `.rs-filter`, `.rs-dest-select` or
  `.rs-dd` so it gets our ring instead.
- **No scrollbars** in the store, and a view with nothing in it (`.is-empty`)
  does not scroll.
- **Poll downloads only while something is happening.**
- **Keep the frontend free of `setInterval` work that runs while idle.**
- **`plugin.json.name`, the zip asset name and the folder name are coupled.**
  Read §7 before touching any of them.

## 11. Known limitations

- No automated tests on the Deck itself; verification is the preview harness
  plus a manual install.
- The tab layout (Store / Library / Downloads / Settings, the full-screen game
  page, the info strip) has only been run in the preview harness so far. What
  the harness cannot show and a Deck must: that `onGamepadFocus` fires on our
  `Focusable`s (the info strip and the Settings section list follow it), that
  the hidden Store tab takes no focus behind another tab, that the `!important`
  sizes on Steam's `Button` / `TextField` / `Dropdown` hold in the client's
  CSS, that focus lands on Steam's real `Dropdown` after a console is picked
  (`pickConsole` guesses its markup), and that `history.replaceState` is as
  harmless to Steam's router as `pushState` has been.
- Scrapers break when a site changes its HTML. `get_status()` reports per-source
  errors and health, the UI shows them in the footer warning and in Settings.
- Box art gaps (live check, Nov 2026, IGDB off): most consoles have a box
  scan for 75-100% of a browse page; C64 and ZX Spectrum have none for about
  half (the sites publish no covers and libretro's names differ), PS Vita
  mostly shows the sites' covers (libretro has few, GameTDB none). IGDB
  fills much of the rest in normal use.
- Sources looked at and left out (Nov 2026): Vimm's Lair (Cloudflare
  Turnstile on game pages), ROMsGames (reCAPTCHA), EmulatorGames (403),
  WoWroms (download link needs a token from obfuscated page script), Myrient
  (shut down March 2026), CDRomance (now a news site), CoolROM (results are
  rendered by script), Nswpedia (datanodes.to download pages).
- Box art grid thumbnails and GameTDB art come from the third-party proxy
  wsrv.nl (setting `boxart_resize`); without it the grid keeps the sites'
  covers and GameTDB is asked directly.
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
- Nswpedia was removed in v1.17.4 (settings revision 5 drops it from
  existing installs, revision 6 its address): every file link it has opens
  datanodes.to's download page, which needs a browser. Switch box art, which
  came from its cover index, comes from GameTDB since v1.17.5.
- RomsFun: its MAME sets come from a file server behind a Cloudflare check
  (reported, not worked around); its console games download normally. The
  speed test skips arcade sets for that reason.
- IGDB client credentials are baked into `backend/settings.py` as defaults so
  covers work out of the box. Do not log them, and treat a leak as a reason to
  rotate them rather than to remove the feature.
- The preview harness pins React 18 because that is what the Steam client ships.
