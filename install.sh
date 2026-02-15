#!/usr/bin/env bash
set -euo pipefail

REPO="rizaleow/ovpn-manager"
BINARY_NAME="ovpn-manager"
INSTALL_DIR="/usr/local/bin"

# --- Helpers ---

info()  { echo -e "\033[1;34m[INFO]\033[0m  $*" >&2; }
ok()    { echo -e "\033[1;32m[OK]\033[0m    $*" >&2; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sudo bash

Downloads the ovpn-manager binary. Run 'sudo ovpn-manager setup' to complete installation.

Options:
  --version <tag>   Specify version (e.g. v1.0.0). Default: latest
  --help            Show this help message
EOF
  exit 0
}

# --- Main ---

main() {
  # Auto-elevate to root
  if [[ $EUID -ne 0 ]]; then
    info "Root required — re-running with sudo..."
    local self
    self=$(mktemp /tmp/ovpn-manager-install.XXXXXX)
    if [[ -f "$0" ]]; then
      cp "$0" "$self"
    else
      curl -fsSL "https://raw.githubusercontent.com/$REPO/main/install.sh" -o "$self"
    fi
    chmod +x "$self"
    exec sudo bash "$self" --_cleanup "$self" "$@"
  fi

  # Clean up temp file from sudo re-exec
  if [[ "${1:-}" == "--_cleanup" ]]; then
    rm -f "$2" 2>/dev/null
    shift 2
  fi

  local version="latest"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version) version="${2:-}"; [[ -n "$version" ]] || error "--version requires a value"; shift 2 ;;
      --help|-h) usage ;;
      *) shift ;;
    esac
  done

  [[ "$(uname -s)" == "Linux" ]] || error "This script only supports Linux"

  # Detect architecture
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64)  arch="x64" ;;
    aarch64) arch="arm64" ;;
    *)       error "Unsupported architecture: $arch" ;;
  esac

  # Resolve version
  if [[ "$version" == "latest" ]]; then
    info "Checking latest version..."
    local tag
    tag=$(curl -fsSI -o /dev/null -w '%{redirect_url}' "https://github.com/$REPO/releases/latest")
    tag="${tag##*/}"
    if [[ -z "$tag" || "$tag" == "releases" ]]; then
      tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')
    fi
    [[ -n "$tag" ]] || error "Could not determine latest version"
    version="$tag"
  fi

  # Download binary
  local url="https://github.com/$REPO/releases/download/$version/ovpn-manager-linux-$arch"
  local tmp
  tmp=$(mktemp)

  info "Downloading ovpn-manager $version (linux-$arch)..."
  if ! curl -fsSL -o "$tmp" "$url"; then
    rm -f "$tmp"
    error "Download failed. Check that version $version exists for linux-$arch"
  fi
  chmod 755 "$tmp"
  mv "$tmp" "$INSTALL_DIR/$BINARY_NAME"

  ok "Binary installed to $INSTALL_DIR/$BINARY_NAME"
  echo ""
  info "Next steps:"
  echo "  sudo ovpn-manager setup     # First-time setup (installs deps, creates config, starts service)"
  echo "  sudo ovpn-manager tui       # Interactive management"
  echo "  sudo ovpn-manager serve     # Start API server"
  echo ""
  echo "  sudo ovpn-manager upgrade   # Self-update to latest version"
  echo "  sudo ovpn-manager uninstall # Remove everything"
  echo ""
}

# Ensure entire script is downloaded before executing (for curl | bash)
main "$@"
