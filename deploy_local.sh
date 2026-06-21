#!/usr/bin/env bash
set -euo pipefail

# Build the plugin and (re)install it into the local test vault at ./isb-vault
# for a quick build-and-check loop. The previous copy of the plugin in the
# vault is removed first, then the freshly built artifacts are copied in.
#
# After running, reload Obsidian (or use the Hot-Reload plugin) to pick up the
# new build.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VAULT_DIR="./isb-vault"
PLUGIN_ID="$(node -p "require('./manifest.json').id")"
PLUGIN_DIR="${VAULT_DIR}/.obsidian/plugins/${PLUGIN_ID}"

if [ ! -d "$VAULT_DIR" ]; then
  echo "error: vault not found at ${VAULT_DIR}" >&2
  echo "       create the Obsidian vault there first, then re-run." >&2
  exit 1
fi

echo "==> Installing dependencies (if needed)"
if [ ! -d node_modules ]; then
  npm install
fi

echo "==> Building plugin"
npm run build

echo "==> Removing previous plugin version in ${PLUGIN_DIR}"
rm -rf "$PLUGIN_DIR"

echo "==> Installing fresh build into ${PLUGIN_DIR}"
mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css "$PLUGIN_DIR/"

echo "==> Done"
echo "    Reload Obsidian (or trigger Hot-Reload) to use the new build."
