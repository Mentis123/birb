#!/usr/bin/env bash
# Idempotent setup for the Playwright-based visual/behaviour harnesses.
# Installs playwright + https-proxy-agent WITHOUT touching package.json,
# restores the hand-written node_modules/three stub that any npm install
# prunes, then ensures a Chromium build is present for Playwright.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[ensure-harness] installing playwright + https-proxy-agent (--no-save)..."
npm install --no-save playwright https-proxy-agent

echo "[ensure-harness] restoring tracked node_modules/three stub..."
git checkout -- node_modules/three/index.js

echo "[ensure-harness] installing chromium (with deps)..."
npx playwright install --with-deps chromium

echo "[ensure-harness] done."
