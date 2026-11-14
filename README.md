# ROM Store — Decky plugin

A game-store style front end for browsing and downloading ROMs on the Steam Deck.
It searches **Romspedia**, **Retrostic**, **RomsDL**, **DumbRoms** and
**MyAbandonware** at the same time, merges the results, removes duplicates, and
drops the file you pick straight into the matching **EmuDecky** ROM folder
(`~/EmuDecky/roms/<system>/`).

![ROM Store](tools/preview/store.png)

---

## What it does

| | |
|---|---|
| **Search** | One search box queries every enabled source in parallel and merges the hits. |
| **Browse** | A console picker with live title counts (including Switch), plus *Load more* for deeper result pages. |
| **Gamepad** | Cards are Steam-focusable — the A button opens a game, the shoulder buttons page through results. |
| **Artwork** | Cover art is fetched by the backend, cached on the Deck and served locally, so nothing is re-downloaded and the Steam client never has to reach out to a third party. |
| **De-duplicate** | Titles are normalised (region tags, serial noise and punctuation are stripped) so the same game from two sites becomes one card with a `2×` badge. |
| **Region variants** | Every source entry is kept as a variant, so the USA / Europe / Japan builds of a title can be picked individually. |
| **One click download** | Press *Download*, the file is fetched in the background and written to the right system folder. |
| **EmuDecky aware** | The ROM root is auto-detected (`~/EmuDecky/roms`, `~/Emulation/roms`, SD cards, …) and the system folder is matched against the folders that actually exist on your Deck. |
| **Progress** | Live progress, speed, cancel button and *Open folder* for finished downloads. |

## Requirements

* SteamOS with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) (v3.1 or newer, `api_version: 1`).
* EmuDecky (or EmuDeck) installed, or any folder you want the games to land in.
* Network access to the ROM sites.

The plugin ships **no Python dependencies** — the backend only uses the standard
library, so there is nothing to compile and nothing to install on the Deck.

## Installation

### Install from the Deck (easiest)

Decky Loader → **Settings → Plugins → Install from URL**, then paste:

```
https://github.com/lauridskern/decky-rom-store/releases/download/v1.0.1/rom-store-decky.zip
```

Decky handles the root-owned `~/homebrew/plugins` folder for you. Restart Decky
Loader afterwards and the plugin appears in the plugin list.

### Install manually over SSH

```bash
# copy the package over first
scp rom-store-decky.zip deck@<deck-ip>:/home/deck/

# then on the Deck (the plugins folder is root owned, hence sudo)
sudo bash -c 'rm -rf /home/deck/homebrew/plugins/rom-store && \
  mkdir -p /home/deck/homebrew/plugins/rom-store && \
  unzip -o /home/deck/rom-store-decky.zip -d /home/deck/homebrew/plugins/rom-store && \
  chown -R root:root /home/deck/homebrew/plugins/rom-store'
```

Use the explicit `/home/deck/...` paths: inside `sudo bash -c` a bare `~`
expands to `/root` instead.

### Building a release

Every `v*` tag builds the package with GitHub Actions and attaches it to the
release:

```bash
git tag -a v1.0.2 -m "v1.0.2" && git push origin v1.0.2
```

### Development

```bash
npm install
npm run build          # bundles src/ into dist/index.js
npm run typecheck      # tsc --noEmit
```

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
| **Romspedia** | `https://www.romspedia.com` — server rendered search, region specific builds, direct file links on `downloads.romspedia.com`. The only source with a **Nintendo Switch** section. |
| **Retrostic** | `https://www.retrostic.com` — large classic catalogue, 46 consoles, direct zip downloads. |
| **RomsDL** | `https://romsdl.com` — the same engine as Retrostic with a different catalogue; good for extra region builds. |
| **DumbRoms** | The base URL and search URL are **settings**, because the domain has moved around. Point *Settings → Sources → DumbRoms* at the address you want to use. The parser is heuristic (it finds repeated link patterns), so it copes with most simple ROM indexes. |
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

So for a full Switch library, point the **DumbRoms** adapter at a Switch-heavy
site — the generic adapter already recognises `.xci`, `.nsp` and `.nsz` files
and maps the console to the `switch` folder.

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

## Settings

* **EmuDecky ROM folder** — override the detected root.
* **Sources** — enable/disable each site, and repoint the DumbRoms adapter.
* **Extract .zip archives** — unzip the download into the system folder.
* **Keep the archive too** — keep the zip next to the extracted files.
* **Results per source** / **Parallel downloads**.

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

**The UI is unstyled**

The stylesheet is rendered inside the plugin's own React tree, so it cannot
be dropped by the Steam client re-rendering its `<head>`. If the plugin was
installed from an older release, update it and restart Decky Loader.

**A source is unreachable**

Each source reports its own status in the status bar (click the warning chip
for the full error). The DumbRoms adapter needs the correct address in
*Settings → Sources*.

## Legal

The plugin is a front end for sites you choose to use. It does not ship, host or
bundle any game content — you are responsible for the source you point it at and
for the material you download.
