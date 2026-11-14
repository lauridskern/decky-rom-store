#!/bin/sh
# Installs the ROM Store plugin into the Decky plugins folder.
#
#   unzip rom-store-decky.zip -d rom-store && sh rom-store/install.sh
#
# or simply:  sh rom-store/install.sh
set -e

PLUGIN_DIR="${HOME}/homebrew/plugins/rom-store"

if [ ! -f "${PLUGIN_DIR}/plugin.json" ]; then
  echo "plugin.json not found in ${PLUGIN_DIR} - extract the zip first:" >&2
  echo "  unzip rom-store-decky.zip -d ${PLUGIN_DIR}" >&2
  exit 1
fi

echo "ROM Store installed in ${PLUGIN_DIR}"
echo "Restart Decky Loader (or reboot the Deck) to load it."
echo
echo "Optional sanity check:"
echo "  python3 ${PLUGIN_DIR}/tools/selftest.py mario"
