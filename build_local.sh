#!/usr/bin/env bash
set -euo pipefail

# Build the Obsidian plugin and stage the files required for a local install
# under ./output/<plugin-id>/. Drop that folder into
# <Vault>/.obsidian/plugins/ and reload Obsidian to use the build.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PLUGIN_ID="$(node -p "require('./manifest.json').id")"
OUTPUT_DIR="./output"
PLUGIN_DIR="${OUTPUT_DIR}/${PLUGIN_ID}"

echo "==> Installing dependencies (if needed)"
if [ ! -d node_modules ]; then
  npm install
fi

echo "==> Building plugin"
npm run build

echo "==> Staging artifacts in ${PLUGIN_DIR}"
rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css "$PLUGIN_DIR/"

echo "==> Done"
echo "    Copy ${PLUGIN_DIR} into <Vault>/.obsidian/plugins/ and reload Obsidian."
