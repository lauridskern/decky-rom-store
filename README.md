# ROM Store — Decky plugin

A game-store style front end for browsing and downloading ROMs on the Steam Deck.
It searches **Romspedia**, **Retrostic**, **RomsDL**, **RomsFun**, **MyAbandonware**
and two Switch catalogues (**Switch ROMs**, **Nswpedia**) at the same time, merges the results, removes duplicates, and
drops the file you pick straight into the matching **EmuDecky** ROM folder
(`~/EmuDecky/roms/<system>/`).

![ROM Store](tools/preview/store.png)

---

## What it does

| | |
|---|---|
| **Search** | One search box queries every enabled source in parallel and merges the hits. |
| **Browse** | The console tiles and dropdown list every console any enabled source can browse, with title counts where known (including Switch), and switching to one browses that catalogue. Counts are scraped once and cached on the Deck for a day. Browsing a console walks the catalogue pages, so Switch shows the whole library (~90 titles) instead of one page. |
| **Gamepad** | Built for the Deck's pad: L1/R1 switch between Store, Library, Downloads and Settings, A opens a game, X searches, Y marks a favourite, L2/R2 turn the page, B goes back one step. |
| **Gallery** | Every game opens with a shelf of artwork that scrolls horizontally: the game's own screenshots, the artwork from the site the game came from, and a trailer. |
| **Metadata** | The description, genres, developer and the community rating all come from IGDB, so every title looks the same no matter which site it was found on. | Click any item for a full screen lightbox, where the trailer plays. Artwork comes from the ROM sites themselves, not from Steam, so it works for every console. |
| **Artwork** | Cover art is fetched by the backend, cached on the Deck and served locally, so nothing is re-downloaded and the Steam client never has to reach out to a third party. Every card uses the same poster frame with a blurred backdrop, so mixed artwork from different sites still looks uniform. Optionally, add free IGDB credentials in the settings to replace missing artwork with clean, high quality poster art. |
| **De-duplicate** | Titles are normalised (region tags, serial noise and punctuation are stripped) so the same game from two sites becomes one card with a `2×` badge. |
| **Region variants** | Every source entry is kept as a variant, so the USA / Europe / Japan builds of a title can be picked individually. |
| **One click download** | Press *Download*, the file is fetched in the background and written to the right system folder. |
| **EmuDecky aware** | The ROM root is auto-detected (`~/EmuDecky/roms`, `~/Emulation/roms`, SD cards, …) and the system folder is matched against the folders that actually exist on your Deck. |
| **Progress** | The Downloads tab shows live progress, speed and time left with a cancel button; the tab itself carries a progress line while something is running, and the game's own page turns its button into the progress. |

## User interface

The store fills the Deck's screen and is laid out for the pad, not for a
mouse. Four tabs sit in the top bar and **L1 / R1** switch between them from
anywhere:

* **Store** – the home screen (recently viewed, favourites, what is in your
  library, every console a source can browse, with its game count where the
  store knows it) and
  the results: a grid of covers in their real box shapes. The line under the
  grid names the cover that has focus, with its console, year, size and rating.
* **Library** – the games in your ROM folders with their box art, the space
  left on each drive, and uninstall.
* **Downloads** – what is running (progress, speed, time left) and what
  finished.
* **Settings** – one section list on the left, the section on the right.
  Changes save by themselves.

A game opens as a full-screen page: the box on the left, the download button
(which becomes the progress while that game is downloading), the other
versions, screenshots, the description and where the file goes.

It is built on `@decky/ui` and `@decky/api`, so dropdowns, text fields and
buttons are the Steam client's own, take gamepad focus and open the on-screen
keyboard.

## Requirements

* SteamOS with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) (v3.1 or newer, `api_version: 1`).
* EmuDecky (or EmuDeck) installed, or any folder you want the games to land in.
* Network access to the ROM sites.

The plugin ships **no Python dependencies** — the backend only uses the standard
library, so there is nothing to compile and nothing to install on the Deck.

## Installation

### Install from the Deck (easiest)

Decky Loader → **Settings → Plugins → Install from URL**, then paste (this
always points at the newest release; pin a version by replacing `latest` with a
tag and `download` with `download/vX.Y.Z`):

```
https://github.com/lauridskern/decky-rom-store/releases/latest/download/ROM-Store.zip
```

> Decky derives the plugin name from the **file name at the end of the URL** and
> expects `plugin.json`'s `name` to match it exactly, so the asset has to be
> called `ROM-Store.zip`.

Decky handles the root-owned `~/homebrew/plugins` folder for you. Restart Decky
Loader afterwards and the plugin appears in the plugin list.

### Install manually over SSH

```bash
# copy the package over first
scp ROM-Store.zip deck@<deck-ip>:/home/deck/

# then on the Deck (the plugins folder is root owned, hence sudo).
# The zip contains a rom-store-decky/ folder - extract it into the plugins
# folder, not into a folder of its own.
sudo bash -c 'cd /home/deck/homebrew/plugins && \
  rm -rf rom-store-decky && \
  unzip -o /home/deck/ROM-Store.zip && \
  chown -R root:root /home/deck/homebrew/plugins/rom-store-decky'
```

Use the explicit `/home/deck/...` paths: inside `sudo bash -c` a bare `~`
expands to `/root` instead.

### Building a release

Every `v*` tag builds the package with GitHub Actions and attaches it to the
release:

```bash
git tag -a v1.0.5 -m "v1.0.5" && git push origin v1.0.5
```

The asset is always named `ROM-Store.zip` and contains a `rom-store-decky/`
folder - Decky needs both to install it.

```bash
python3 tools/verify_package.py ROM-Store.zip   # checks it against Decky's own install logic
```

### Development

```bash
npm install
npm run build          # bundles src/ into dist/index.js
npm run typecheck      # tsc --noEmit
```

`AGENTS.md` (and `CLAUDE.md`) document the architecture, the browser preview
harness under `tools/preview`, the test expectations and the release checklist.

Useful extras:

```bash
python3 tools/selftest.py "mario"   # exercises the backend against the live sites
```

`tools/selftest.py` searches, resolves the download links and downloads one game
into a temporary folder, so you can verify the scrapers without touching your
real ROM library.

## Sources

| Source | Notes |
|---|---|
| **Switch ROMs** | `https://nintendo-switch-roms.com` — a Switch specific catalogue with hundreds of NSP/XCI titles. The game pages link straight to the file (no captcha, no countdown), so the downloads are direct. The base URL is a setting, so a mirror of the same site works too. |
| **Romspedia** | `https://www.romspedia.com` — server rendered search, region specific builds, direct file links on `downloads.romspedia.com`. The only source with a **Nintendo Switch** section. |
| **Retrostic** | `https://www.retrostic.com` — large classic catalogue, 46 consoles, direct zip downloads. |
| **RomsDL** | `https://romsdl.com` — the same engine as Retrostic with a different catalogue; good for extra region builds. |
| **RomsFun** | `https://romsfun.com` — large catalogue across 50+ consoles, including romhacks and fan translations (listed after the games). Each download waits out the site's 7-second countdown, as a visitor would. |
| **Nswpedia** | `https://nswpedia.io` — a Switch catalogue with its own search; titles, covers and sizes come from its result cards. |
| **MyAbandonware** | `https://www.myabandonware.com` — backed by a TypeSense index. The plugin reads the short-lived scoped search key out of the search page and queries the index directly. Older PC and console titles. |

Each source can be switched off individually if it is unreachable; failures are
reported per source in the status bar instead of breaking the whole search.

> The `romspedia.net` domain currently answers with a parked/redirect page — the
> working address is `romspedia.com`, which is what the plugin uses by default.

### About Nintendo Switch

Switch **is** fully supported: Switch titles are recognised, the browse panel
lists them and downloads land in `~/EmuDecky/roms/switch/`.

What the catalogues actually contain is the limiting factor, not the plugin:

* **Romspedia** has a Switch section with **9 titles** (Pokémon Brilliant
  Diamond/Shining Pearl, Animal Crossing: New Horizons, Sonic Mania Plus,
  Kirby and the Forgotten Land, Mario Strikers Battle League, Fire Emblem
  Warriors: Three Hopes, Castle Crashers Remastered, The Jackbox Party Pack 6).
  Searches for *Metroid Dread*, *Splatoon*, *Tears of the Kingdom* or
  *Mario Kart 8* return **no Switch results** — those titles simply are not in
  the index.
* **Retrostic / RomsDL / MyAbandonware** carry no Switch catalogue at all
  (MyAbandonware's platform list has 144 platforms, Switch is not one of them).

For Switch games the two Switch catalogues, **Switch ROMs** and **Nswpedia**,
carry far more titles; both are searched and browsed alongside the others.

## Where files land

The plugin resolves the ROM root automatically:

1. the path you set in *Settings → ROM library* (if it exists),
2. `~/EmuDecky/roms`,
3. `~/Emulation/roms`,
4. `~/roms`,
5. `*/EmuDecky/roms` and `*/Emulation/roms` on mounted SD cards.

Inside that root the console folder is matched against the folders that really
exist (`n64`, `snes`, `switch`, `ps2`, `dos`, …) and created if it is missing.
The destination path is always shown before a download starts.

Existing files are never overwritten silently — the new file is written as
`Name (2).zip` instead.

## Fastest download first

Every download is timed. The store learns how fast each provider delivers, and
how long it takes to hand out the link (some sites have a form or a countdown
first). The game page then puts the file that should finish first on top,
marked **Fastest**, and shows each provider's speed next to its files. Your
preferred region still comes first. *Settings → Sources* shows each source's
measured speed.

## Library

The **Library** tab (and the **In your library** row on the home screen) lists
every game in your ROM folders with its box art and size: by console, newest
first, largest first or A to Z. On top it shows how full each drive is.
**A** on a game asks before it removes anything ("Delete 3 files, 963 MB? This
cannot be undone.", with *Keep* selected; **B** also keeps) and then removes
that game's files: all discs of a multi-disc game together. **Y** opens the
game's store page. Saves, EmuDeck's notes and artwork folders are never
touched, and nothing outside the ROM folders can be deleted.

## Steam library

Every game you download is added to your Steam library straight away, and
removed again when you uninstall it, with no Steam restart. The launch command
comes from your **Steam ROM Manager** setup (the one EmuDeck creates), so the
shortcut starts the game exactly like a shortcut made by SRM. A shortcut SRM
already made for the same file is reused, not doubled.

Like SRM, each shortcut gets library art: cover, wide cover, hero, logo and
icon from **SteamGridDB** once you enter your own free API key in
*Settings → Steam library* (steamgriddb.com → Preferences → API). Without a key
the cover and hero come from IGDB. Art a shortcut already has is never replaced.

*Settings → Steam library → Sync with Steam now* checks the whole library both
ways and lists consoles that have no SRM parser yet.

**Run Steam ROM Manager…** in the same place runs SRM itself, for its own
titles, artwork and controller layouts. SRM needs Steam closed, so after you
confirm, ROM Store hands its own shortcuts over to SRM (so nothing is doubled),
closes Steam, runs SRM, and Steam starts again; the result is shown once Steam
is back. SRM is found in `Emulation/tools/srm` (EmuDeck) automatically. Steam ROM Manager itself
needs Steam closed, which is why the plugin does this through Steam's own
shortcut API instead of running SRM.

## Settings

The Settings tab has six sections; every change is saved as you make it.

* **Library** — the ROM folder (detected, or your own) and the drives.
* **Sources** — enable/disable each site, change its address, and see how it
  has been doing (last answer, failures in a row, measured speed).
* **Downloads** — extract .zip archives, keep the archive too, results per
  source, parallel downloads.
* **Artwork** — box art, the grid thumbnails, IGDB (optional: your own free
  client ID / secret from twitch.tv/developers).
* **Steam** — add downloads to the Steam library, collections, library
  artwork, SteamGridDB key, sync, run Steam ROM Manager.
* **Advanced** — layout offsets, the search cache, diagnostics.

## Troubleshooting

**"certificate verify failed" / every source shows as unavailable**

SteamOS ships an outdated CA bundle, so Python cannot verify modern
certificates. The plugin ships its own up to date CA store
(`backend/cacert.pem`) and uses it for every request, and falls back to a
relaxed context if even that fails. The trust store in use is logged on
startup:

```bash
grep "TLS trust store" ~/homebrew/logs/rom-store/rom-store.log
```

**The store is cut off by the Steam header bar**

The plugin measures the Steam chrome at runtime (it hit tests the DOM to find
where its own content becomes visible) and pads itself accordingly, so it works
in both Game Mode and Desktop Mode.

**The console list says "unavailable"**

The console list is scraped in the background and cached in
`~/homebrew/data/rom-store-decky/system_counts.json`. If it is empty the
backend could not reach Romspedia - check the status line in the plugin menu.

**The UI is unstyled**

The stylesheet is rendered inside the plugin's own React tree, so it cannot
be dropped by the Steam client re-rendering its `<head>`. If the plugin was
installed from an older release, update it and restart Decky Loader.

**A source is unreachable**

Each source reports its own status in the status bar (click the warning chip
for the full error). *Settings → Sources* shows when each source last answered;
one that fails three times in a row is skipped for 15 minutes.

## Caching

Search and browse results are cached on the Deck in
`~/homebrew/data/rom-store-decky/search_cache.json` and stay valid for
**72 hours** by default (*Settings → Offline cache → Keep results for*).

Repeating a search is therefore instant, even after a restart, and the cached
entry already contains the resolved download links, so a game you looked at
before can be downloaded without touching the network again. The footer shows
`cached ·` when a result came from the cache.

## Artwork

Cover art is downloaded by the backend, cached in
`~/homebrew/data/rom-store-decky/covers/` and served to the UI from
`http://localhost:1337/plugins/ROM-Store/data/covers/...` - the same origin the
Steam client uses (so the content policy allows it) and under the plugin *name*
Decky keys its file routes by. Games without artwork (or with artwork the source does not publish) show a
plain placeholder instead of a broken image, and the gallery shows the five
most relevant screenshots plus the trailer. Screenshots are fetched in a small
size (about 30 kB) for the strip and only the full resolution is pulled in
when you open one. If artwork still does not show up,
open **Settings → Diagnostics → Test image pipeline**; it prints the plugin
folder, the resolved local URL and the cache folder.

**Artwork is never cropped.** Console box art differs in shape: an NES box, a
DS box and an arcade flyer are three different rectangles. Every card uses one
poster frame so the rows stay even, but the picture inside it keeps its own
proportions - it is fitted, and the space it leaves is filled with a dimmed,
blown-up copy of the same art rather than black bars. The same rule applies to
the poster in the game panel, which uses the shape of the console it belongs
to. Only artwork within 4% of the frame is allowed to fill it.

## Performance

The store is built to stay quiet on a device that is also running a game:

- **One page of results at a time.** A search fetches a few pages worth of
  results up front, then paging is instant and client-side. The grid renders at
  most 30 cards, so moving through the catalogue never re-decodes cover art.
- **No windowed list.** Windowing a grid of images meant mounting fresh `<img>`
  elements on every scroll frame - the same covers were decoded over and over,
  and the measured-row bookkeeping re-laid out the grid constantly. The page is
  now rendered once and scrolling is pure paint work.
- **Small images.** Cards use the 180x256 IGDB cover (about 8 kB) and the
  medium screenshot size (about 34 kB); full resolution is only fetched when
  you open one.
- **Nothing polls on a timer** unless something is actually downloading, and
  the download poll stops as soon as the queue is empty.
- **Cached detail views.** Download links and the gallery are cached for the
  same 72 hours as searches, so opening a game (or closing it again) starts no
  scraping at all.
- **One cache file per query.** Cached searches and detail views used to share
  a single growing JSON document that was read, parsed and rewritten on every
  search - after a long session that is tens of megabytes of work per keystroke
  and it blocks everything else while it runs. Each query now has its own small
  file, pruned to the 300 most recent.
- **Artwork is fetched in parallel**, not queued behind the scraper's
  per-host politeness delay, so a page of covers arrives in one burst.
- **Settings → Advanced** shows a live sample (frame time, DOM nodes, image
  count, JS heap) and has a *Reload the store* button that rebuilds the UI
  without restarting Steam.
- **The Store tab stays loaded** behind the other tabs, so coming back to it
  decodes no cover again; the other tabs exist only while they are open.

## Gamepad

Everything is reachable with the pad; Steam's bar at the bottom shows what the
buttons do where you are.

| where | buttons |
|---|---|
| anywhere | **L1 / R1** previous / next tab · **X** search · **B** back one step |
| home | d-pad through the shelves and the consoles · **A** open · **Y** favourite |
| results | **A** game page · **Y** favourite · **L2 / R2** previous / next page · **B** home |
| game page | starts on Download · **A / X** download · **Y** favourite · **L1 / R1** previous / next game · **B** close |
| library | **A** uninstall (asks, *Keep* selected) · **Y** store page |
| downloads | **A** cancel, or open a finished game's page · **X** clear finished |
| settings | d-pad up/down picks a section, right goes into it · **A** flips a switch |
| screenshot viewer | **◀ ▶ / A** next · **B** back to the game page |

## The back button

The Steam Deck's **B** button steps back the way you came:

* in a screenshot → the game page; on the game page → where you opened it;
* on the Library, Downloads or Settings tab → the Store;
* on a result list → the home screen;
* on the home screen → out of the plugin, like any other Decky route.

That works because the plugin pushes a history entry for each of those steps,
so the Steam client's own back navigation lands on them first.

## Legal

The plugin is a front end for sites you choose to use. It does not ship, host or
bundle any game content — you are responsible for the source you point it at and
for the material you download.
