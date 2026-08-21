#!/usr/bin/env bash
# Download the official Caddy binary for this platform (gitignored).
# Idempotent: skips if a working caddy binary already exists.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -x ./caddy ]; then
  echo "caddy already present: $(./caddy version 2>/dev/null | head -1)"
  exit 0
fi

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=mac ;;
  *) echo "Unsupported OS: $(uname -s). Install Caddy manually: https://caddyserver.com/download" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

echo "Fetching latest Caddy release tag..."
TAG=$(curl -s https://api.github.com/repos/caddyserver/caddy/releases/latest | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')
[ -n "$TAG" ] || { echo "Could not determine latest tag" >&2; exit 1; }
echo "Downloading Caddy $TAG ($OS/$ARCH)..."
curl -sL -o caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/${TAG}/caddy_${TAG#v}_${OS}_${ARCH}.tar.gz"
tar -xzf caddy.tar.gz caddy
rm caddy.tar.gz
chmod +x caddy
echo "Installed: $(./caddy version)"
