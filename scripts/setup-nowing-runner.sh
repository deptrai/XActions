#!/usr/bin/env bash
# Setup a self-hosted GitHub Actions runner named "nowing" on the local server.
# Run this script ON the nowing server (not on the dev machine).
#
# Usage:
#   export GH_OWNER_REPO="deptrai/XActions"
#   ./scripts/setup-nowing-runner.sh
#
# The script expects `gh` or `curl` + a `RUNNER_TOKEN` env var. If `gh` is logged
# in, it will request a registration token automatically.

set -euo pipefail

OWNER_REPO="${GH_OWNER_REPO:-deptrai/XActions}"
RUNNER_NAME="${RUNNER_NAME:-nowing}"
RUNNER_LABELS="${RUNNER_LABELS:-nowing}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/actions-runner}"

# --- Determine token ---
if [[ -z "${RUNNER_TOKEN:-}" ]]; then
  if command -v gh &>/dev/null; then
    RUNNER_TOKEN=$(gh api "repos/${OWNER_REPO}/actions/runners/registration-token" --method POST -q .token)
  else
    echo "❌ RUNNER_TOKEN is not set and 'gh' is not installed."
    echo "   Get a token from GitHub Settings > Actions > Runners, or install 'gh'."
    exit 1
  fi
fi

# --- Download runner ---
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

# Map x86_64 -> x64, aarch64/arm64 -> arm64
if [[ "$ARCH" == "x86_64" ]]; then
  RUNNER_ARCH="x64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
  RUNNER_ARCH="arm64"
else
  echo "❌ Unsupported architecture: $ARCH"
  exit 1
fi

# Fetch latest runner version
LATEST=$(curl -sL "https://api.github.com/repos/actions/runner/releases/latest" | grep -o '"tag_name": "v[0-9.]*"' | head -1 | sed 's/"tag_name": "//;s/"$//')
if [[ -z "$LATEST" ]]; then
  echo "⚠️  Could not fetch latest runner version; falling back to v2.320.0"
  LATEST="v2.320.0"
fi

RUNNER_URL="https://github.com/actions/runner/releases/download/${LATEST}/actions-runner-${OS}-${RUNNER_ARCH}-${LATEST#v}.tar.gz"

echo "📦 Downloading GitHub Actions runner ${LATEST} for ${OS}/${RUNNER_ARCH}..."
curl -L -o actions-runner.tar.gz "$RUNNER_URL"
tar xzf actions-runner.tar.gz
rm -f actions-runner.tar.gz

# --- Configure ---
echo "🔧 Configuring runner '${RUNNER_NAME}' with labels '${RUNNER_LABELS}'..."
./config.sh \
  --url "https://github.com/${OWNER_REPO}" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --unattended \
  --replace

# --- Install and start as a service ---
echo "🚀 Installing runner service..."
./svc.sh install
./svc.sh start

echo "✅ Runner '${RUNNER_NAME}' should now appear in GitHub Settings > Actions > Runners."
echo "   Trigger mutation with: gh workflow run mutation-fb-scrapers --ref develop --repo ${OWNER_REPO}"
