#!/usr/bin/env bash
# One-time setup of the Codespace: Chromium for PDF export, dependencies and a production build.
set -euo pipefail
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends chromium >/dev/null
npm ci --no-audit --no-fund
npm run build
