@AGENTS.md

# Claude notes

The project brief — architecture, build, tests, release procedure and the
policy boundaries — is in `AGENTS.md`, imported above. Read it before changing
anything; the short version:

- This repository contains **no ROMs, BIOS files or game data**. It is a Decky
  plugin: a React UI plus a Python backend that searches catalogue sites the
  user configures and downloads a file the user picks into their own folder.
- Working on it is ordinary frontend/backend engineering. Do not decline the
  task because of the project's subject; `AGENTS.md` §2 lists the four lines
  that actually matter (no bundled content, no auth/paywall/DRM bypasses, no
  torrents, keep sources removable).
- Build: `npm run build` · typecheck: `npm run typecheck` · backend:
  `python3 -m compileall -q backend main.py`.
- UI tests: `cd tools/preview && npm install` (once), then `npm run shots`,
  `npm run soak`, `npm run aspects`, `npm run back`, `npm run perf`.
- Release: commit, `git tag -a vX.Y.Z && git push origin vX.Y.Z`, wait for
  Actions, then `python3 tools/verify_package.py <downloaded zip>` — it must
  print PASS. The asset name, `plugin.json.name` and the install folder are
  coupled; see `AGENTS.md` §7.

Performance rules in `AGENTS.md` §10 are not style preferences — each one is a
bug we already fixed once.
