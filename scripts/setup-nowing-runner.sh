#!/usr/bin/env bash
# Setup a self-hosted GitHub Actions runner named "nowing" on the local server.
# Run this script ON the nowing server (not on the dev machine).
#
# Usage:
#   export GH_OWNER_REPO="deptrai/XActions"
#   ./scripts/setup-nowing-runner.sh
#
# The script can be run as root. If run as root, it creates a dedicated
# 'nowing-runner' user and installs the runner under /home/nowing-runner.
# It then starts the runner in the background with nohup.
#
# The script expects a `RUNNER_TOKEN` env var. If `gh` is installed and
# authenticated, it can fetch the token automatically when `RUNNER_TOKEN` is not set.

set -euo pipefail

OWNER_REPO="${GH_OWNER_REPO:-deptrai/XActions}"
RUNNER_NAME="${RUNNER_NAME:-nowing}"
RUNNER_LABELS="${RUNNER_LABELS:-nowing}"
RUNNER_USER="${RUNNER_USER:-nowing-runner}"

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

# --- If running as root, create a dedicated runner user ---
if [[ "$(id -u)" -eq 0 ]]; then
  if ! id -u "$RUNNER_USER" &>/dev/null; then
    echo "👤 Creating runner user '${RUNNER_USER}'..."
    useradd -m -s /bin/bash "$RUNNER_USER"
  fi
  INSTALL_DIR="/home/${RUNNER_USER}/actions-runner"
  RUN_AS_USER="$RUNNER_USER"
else
  INSTALL_DIR="${INSTALL_DIR:-$HOME/actions-runner}"
  RUN_AS_USER=""
fi

# --- Download runner ---
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

if [[ "$ARCH" == "x86_64" ]]; then
  RUNNER_ARCH="x64"
elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
  RUNNER_ARCH="arm64"
else
  echo "❌ Unsupported architecture: $ARCH"
  exit 1
fi

LATEST=$(curl -sL "https://api.github.com/repos/actions/runner/releases/latest" | grep -o '"tag_name": "v[0-9.]*"' | head -1 | sed 's/"tag_name": "//;s/"$//')
if [[ -z "$LATEST" ]]; then
  echo "⚠️  Could not fetch latest runner version; falling back to v2.336.0"
  LATEST="v2.336.0"
fi

RUNNER_URL="https://github.com/actions/runner/releases/download/${LATEST}/actions-runner-${OS}-${RUNNER_ARCH}-${LATEST#v}.tar.gz"

echo "📦 Downloading GitHub Actions runner ${LATEST} for ${OS}/${RUNNER_ARCH}..."
curl -L -o actions-runner.tar.gz "$RUNNER_URL"
tar xzf actions-runner.tar.gz
rm -f actions-runner.tar.gz

# Ensure correct ownership when run as root
if [[ -n "$RUN_AS_USER" ]]; then
  chown -R "$RUN_AS_USER:$RUN_AS_USER" "$INSTALL_DIR"
fi

# --- Configure ---
echo "🔧 Configuring runner '${RUNNER_NAME}' with labels '${RUNNER_LABELS}'..."
CONFIG_CMD="./config.sh --url https://github.com/${OWNER_REPO} --token ${RUNNER_TOKEN} --name ${RUNNER_NAME} --labels ${RUNNER_LABELS} --unattended --replace"
if [[ -n "$RUN_AS_USER" ]]; then
  su - "$RUN_AS_USER" -c "cd ${INSTALL_DIR} && ${CONFIG_CMD}"
else
  eval "$CONFIG_CMD"
fi

# --- Start in background ---
echo "🚀 Starting runner in the background..."
START_CMD="cd ${INSTALL_DIR} && nohup ./run.sh > /tmp/nowing-runner.log 2>&1 & disown; sleep 2; ps aux | grep -v grep | grep run.sh || true"
if [[ -n "$RUN_AS_USER" ]]; then
  su - "$RUN_AS_USER" -c "$START_CMD"
else
  eval "$START_CMD"
fi

echo "✅ Runner '${RUNNER_NAME}' should now appear in GitHub Settings > Actions > Runners."
echo "   Logs: /tmp/nowing-runner.log"
echo "   Trigger mutation with: gh workflow run mutation-fb-scrapers -f branch=develop --repo ${OWNER_REPO}"
