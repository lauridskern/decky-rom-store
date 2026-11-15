"""Run Steam ROM Manager itself (Settings -> Steam library -> Run).

SRM writes Steam's shortcuts.vdf, which Steam only reads at start and writes
back when it exits, so Steam has to be closed while SRM runs (EmuDeck's own
SRM launcher closes it too). The sequence:

1. the frontend hands the plugin's own live shortcuts over (removes them, so
   SRM does not add the same games a second time)
2. start(): a small shell helper is started in its own session, outside Steam;
   it waits until Steam has closed, runs `<SRM> add` and writes the result
3. the frontend closes Steam; Game Mode starts it again by itself
4. after the restart the frontend reads the result (status()), says how it
   went and runs a normal sync, which adopts SRM's new shortcuts

The helper is a shell script on purpose: Decky's backend can be a bundled
Python, and its LD_LIBRARY_PATH breaks other programs, so it is cleared for
the helper and SRM.
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import time
from typing import Any, Dict, List, Optional

FLATPAK_ID = "com.steamgriddb.steam-rom-manager"

HELPER = r"""#!/bin/sh
# Written by ROM Store: run Steam ROM Manager once Steam has closed.
LOG="$1"; RESULT="$2"; shift 2
say() { echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }
done_with() { echo "{\"ok\": $1, \"code\": $2, \"at\": $(date +%s), \"error\": \"$3\"}" > "$RESULT"; }

say "waiting for Steam to close"
i=0
while pgrep -x steam >/dev/null 2>&1 || pgrep -x steamwebhelper >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then
    say "Steam did not close within two minutes; SRM not run"
    done_with false 1 "Steam did not close"
    exit 1
  fi
  sleep 1
done
sleep 2

say "running: $*"
if command -v timeout >/dev/null 2>&1; then RUN="timeout 900"; else RUN=""; fi
$RUN "$@" >> "$LOG" 2>&1
code=$?
if [ "$code" -ne 0 ] && grep -qi "sandbox" "$LOG"; then
  say "retrying without Electron's sandbox"
  exe="$1"; shift
  $RUN "$exe" --no-sandbox "$@" >> "$LOG" 2>&1
  code=$?
fi
if [ "$code" -eq 0 ]; then
  say "Steam ROM Manager finished"
  done_with true 0 ""
else
  say "Steam ROM Manager failed with exit code $code"
  done_with false "$code" "Steam ROM Manager exited with code $code"
fi
"""


def _home() -> str:
    try:
        import decky  # type: ignore

        home = getattr(decky, "DECKY_USER_HOME", None)
        if home:
            return str(home)
    except ImportError:
        pass
    return os.path.expanduser("~")


def find_srm(roms_root: str, configured: str = "") -> Optional[List[str]]:
    """The command that runs SRM's `add`, or None if SRM is not installed."""
    home = _home()
    if configured:
        path = os.path.expanduser(configured.strip())
        if os.path.isfile(path):
            return [path, "add"]
    bases = []
    if roms_root:
        bases.append(os.path.dirname(roms_root.rstrip("/")))  # .../Emulation
    bases += [os.path.join(home, "Emulation"), os.path.join(home, "EmuDecky")]
    bases += sorted(glob.glob("/run/media/*/Emulation")) + sorted(glob.glob("/run/media/*/*/Emulation"))
    patterns: List[str] = []
    for base in bases:
        patterns += [os.path.join(base, "tools", "srm", "srm-cli*"), os.path.join(base, "tools", "srm", "*.AppImage")]
    patterns += [
        os.path.join(home, "Applications", "*[Ss]team*[Rr][Oo][Mm]*.AppImage"),
        os.path.join(home, "Applications", "srm*", "*.AppImage"),
    ]
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return [path, "add"]
    flatpak = shutil.which("flatpak")
    if flatpak and any(
        os.path.isdir(p) for p in (
            os.path.join(home, ".local/share/flatpak/app", FLATPAK_ID),
            os.path.join("/var/lib/flatpak/app", FLATPAK_ID),
        )
    ):
        return [flatpak, "run", FLATPAK_ID, "add"]
    return None


class SrmRunner:
    def __init__(self, runtime_dir: Optional[str]):
        self._dir = os.path.join(runtime_dir, "srm") if runtime_dir else None
        self._process: Optional[subprocess.Popen] = None

    def _path(self, name: str) -> Optional[str]:
        return os.path.join(self._dir, name) if self._dir else None

    def status(self, roms_root: str, configured: str = "") -> Dict[str, Any]:
        command = find_srm(roms_root, configured)
        last = None
        result = self._path("result.json")
        if result and os.path.isfile(result):
            try:
                with open(result, "r", encoding="utf-8") as fh:
                    last = json.load(fh)
            except (OSError, ValueError):
                last = None
        log_tail: List[str] = []
        log = self._path("run.log")
        if log and os.path.isfile(log):
            try:
                with open(log, "r", encoding="utf-8", errors="replace") as fh:
                    log_tail = [line.rstrip() for line in fh.readlines()[-12:]]
            except OSError:
                pass
        running = self._process is not None and self._process.poll() is None
        return {
            "found": bool(command),
            "command": " ".join(command) if command else None,
            "running": running,
            "last": last,
            "log": log_tail,
        }

    def start(self, roms_root: str, configured: str = "") -> Dict[str, Any]:
        command = find_srm(roms_root, configured)
        if not command:
            return {"ok": False, "error": "Steam ROM Manager was not found (looked in Emulation/tools/srm and ~/Applications)."}
        if not self._dir:
            return {"ok": False, "error": "No place to keep the run's log."}
        if self._process is not None and self._process.poll() is None:
            return {"ok": False, "error": "Steam ROM Manager is already waiting to run."}
        os.makedirs(self._dir, exist_ok=True)
        script, log, result = self._path("run.sh"), self._path("run.log"), self._path("result.json")
        with open(script, "w", encoding="utf-8") as fh:
            fh.write(HELPER)
        os.chmod(script, 0o755)
        with open(log, "w", encoding="utf-8") as fh:
            fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} ROM Store starts Steam ROM Manager\n")
        if os.path.exists(result):
            os.remove(result)
        env = dict(os.environ)
        # A bundled Python's library path breaks other programs (SRM).
        env.pop("LD_LIBRARY_PATH", None)
        if env.get("LD_LIBRARY_PATH_ORIG"):
            env["LD_LIBRARY_PATH"] = env.pop("LD_LIBRARY_PATH_ORIG")
        env["HOME"] = _home()
        env.setdefault("DISPLAY", ":0")
        try:
            env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
        except AttributeError:  # pragma: no cover - not on Linux
            pass
        try:
            self._process = subprocess.Popen(
                ["/bin/sh", script, log, result, *command],
                env=env,
                cwd=_home(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,  # survives Steam closing
            )
        except OSError as exc:
            return {"ok": False, "error": f"Could not start the helper: {exc}"}
        return {"ok": True, "command": " ".join(command)}

    def acknowledge(self) -> None:
        """The result was shown; do not report it again after the next start."""
        result = self._path("result.json")
        if not result or not os.path.isfile(result):
            return
        try:
            with open(result, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            data["seen"] = True
            with open(result, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
        except (OSError, ValueError):
            pass
