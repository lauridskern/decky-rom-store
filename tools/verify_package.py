#!/usr/bin/env python3
"""Verify the release package against Decky Loader's real install logic.

Decky (backend/decky_loader/browser.py) does exactly this:

    zip_file.extractall(self.plugin_path)
    plugin_folder = self.find_plugin_folder(name)

and the name comes from the URL the user pasted (frontend/src/store.tsx):

    splitURL[splitURL.length - 1].replace('.zip', '')

So the package has to contain a single top level folder, and the "name" key in
plugin.json has to match the asset file name exactly.

Usage:  python3 tools/verify_package.py [path/to/ROM-Store.zip]
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import zipfile
from urllib.parse import urlparse

DEFAULT_ASSET = "ROM-Store.zip"
URL = f"https://github.com/uposum/decky-rom-store/releases/download/v1.0.0/{DEFAULT_ASSET}"


def find_plugin_folder(plugin_path: str, name: str):
    """Copy of Decky's PluginBrowser.find_plugin_folder."""
    for folder in os.listdir(plugin_path):
        try:
            with open(os.path.join(plugin_path, folder, "plugin.json"), "r", encoding="utf-8") as fh:
                plugin = json.load(fh)
            if plugin["name"] == name:
                return folder
        except Exception:
            continue
    return None


def main() -> int:
    archive = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ASSET
    if not os.path.isfile(archive):
        print(f"FAIL  {archive} not found")
        return 1

    # The name Decky derives from the URL the user pastes.
    name = urlparse(URL).path.rsplit("/", 1)[-1].replace(".zip", "")
    print(f"URL               : {URL}")
    print(f"derived name      : {name!r}")

    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        plugin_jsons = [n for n in names if n.endswith("/plugin.json") and n.count("/") == 1]
        print(f"plugin.json in zip: {plugin_jsons}")
        if len(plugin_jsons) != 1:
            print("FAIL  the zip must contain exactly one <folder>/plugin.json")
            return 1

        with zf.open(plugin_jsons[0]) as fh:
            plugin = json.loads(fh.read().decode("utf-8"))
        print(f"plugin.json name  : {plugin.get('name')!r}")
        if plugin.get("name") != name:
            print(f"FAIL  plugin.json name {plugin.get('name')!r} != derived name {name!r}")
            return 1

        # Now do what Decky does.
        plugins_path = tempfile.mkdtemp(prefix="decky-plugins-")
        zf.extractall(plugins_path)
        entries = sorted(os.listdir(plugins_path))
        print(f"extracted into    : {entries}")

        folder = find_plugin_folder(plugins_path, name)
        if folder is None:
            print("FAIL  find_plugin_folder() found no matching plugin folder")
            return 1
        print(f"plugin folder     : {folder}")

        for required in ("plugin.json", "main.py", "dist/index.js", "backend/service.py"):
            path = os.path.join(plugins_path, folder, required)
            print(f"  {'OK  ' if os.path.isfile(path) else 'FAIL'} {required}")
            if not os.path.isfile(path):
                return 1

        # @decky/rollup writes plugin.json's name into the bundle, and the page
        # calls the backend of that name. A package renamed after the build
        # loads a page that cannot reach its own backend.
        import re

        with open(os.path.join(plugins_path, folder, "dist", "index.js"), "rb") as fh:
            match = re.search(rb"const manifest\s*=\s*(\{[^}]*\})", fh.read(200_000))
        built_for = json.loads(match.group(1)).get("name") if match else None
        print(f"page built for    : {built_for!r}")
        if built_for != name:
            print(f"FAIL  dist/index.js was built for {built_for!r}, plugin.json says {name!r}")
            return 1

        # The backend has to import cleanly from the extracted folder.
        import subprocess

        check = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, '.'); import main; p = main.Plugin.instance(); "
             "print('backend import OK, api_version =', __import__('json').load(open('plugin.json'))['api_version'])"],
            cwd=os.path.join(plugins_path, folder),
            capture_output=True,
            text=True,
        )
        print(check.stdout.strip() or check.stderr.strip()[-500:])
        if check.returncode != 0:
            print("FAIL  the backend could not be imported from the package")
            return 1

        shutil.rmtree(plugins_path, ignore_errors=True)

    print("\nPASS  the package installs with Decky's own logic")
    return 0


if __name__ == "__main__":
    sys.exit(main())
