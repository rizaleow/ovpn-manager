#!/usr/bin/env bash
set -euo pipefail

REPO="rizaleow/ovpn-manager"
BINARY_NAME="ovpn-manager"
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/ovpn-manager"
CONFIG_FILE="$CONFIG_DIR/config.json"
SERVICE_FILE="/etc/systemd/system/ovpn-manager.service"

# --- Helpers ---

info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m    $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; exit 1; }

usage() {
  cat <<EOF
Usage: $0 [command] [options]

Commands:
  install     Install ovpn-manager (default)
  upgrade     Upgrade to a new version
  uninstall   Remove ovpn-manager

Options:
  --version <tag>   Specify version to install (e.g. v1.0.0). Default: latest
  --help            Show this help message
EOF
  exit 0
}

check_root() {
  [[ $EUID -eq 0 ]] || error "This script must be run as root"
}

check_linux() {
  [[ "$(uname -s)" == "Linux" ]] || error "This script only supports Linux"
}

detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64)  echo "x64" ;;
    aarch64) echo "arm64" ;;
    *)       error "Unsupported architecture: $arch" ;;
  esac
}

get_latest_version() {
  local url="https://api.github.com/repos/$REPO/releases/latest"
  local tag
  tag=$(curl -fsSL "$url" | grep '"tag_name"' | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')
  [[ -n "$tag" ]] || error "Could not determine latest release version"
  echo "$tag"
}

download_binary() {
  local version="$1"
  local arch="$2"
  local url="https://github.com/$REPO/releases/download/$version/ovpn-manager-linux-$arch"
  local tmp
  tmp=$(mktemp)

  info "Downloading ovpn-manager $version (linux-$arch)..."
  curl -fsSL -o "$tmp" "$url" || error "Download failed. Check that version $version exists for linux-$arch"
  chmod 755 "$tmp"
  echo "$tmp"
}

install_service() {
  cat > "$SERVICE_FILE" <<'UNIT'
[Unit]
Description=OpenVPN Manager API
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ovpn-manager --config /etc/ovpn-manager/config.json
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT
}

create_default_config() {
  cat > "$CONFIG_FILE" <<'JSON'
{
  "listen": { "host": "127.0.0.1", "port": 3000 },
  "apiKey": "",
  "dbPath": "/etc/ovpn-manager/ovpn-manager.db",
  "vpn": {
    "hostname": "vpn.example.com",
    "port": 1194,
    "protocol": "udp",
    "devType": "tun",
    "subnet": "10.8.0.0",
    "subnetMask": "255.255.255.0",
    "dns": ["1.1.1.1", "1.0.0.1"],
    "cipher": "AES-256-GCM"
  },
  "paths": {
    "easyrsaDir": "/etc/openvpn/easy-rsa",
    "serverConfigPath": "/etc/openvpn/server.conf",
    "statusFile": "/var/log/openvpn/status.log",
    "logFile": "/var/log/openvpn/openvpn.log",
    "managementSocket": "/var/run/openvpn/management.sock",
    "clientConfigDir": "/etc/openvpn/ccd"
  },
  "logLevel": "info"
}
JSON
}

# --- Commands ---

do_install() {
  local version="$1"
  local arch
  arch=$(detect_arch)

  [[ "$version" == "latest" ]] && version=$(get_latest_version)

  info "Installing ovpn-manager $version..."

  # Install system dependencies
  info "Installing system dependencies..."
  apt-get update -qq
  apt-get install -y openvpn easy-rsa iptables-persistent

  # Download and install binary
  local tmp
  tmp=$(download_binary "$version" "$arch")
  mv "$tmp" "$INSTALL_DIR/$BINARY_NAME"
  ok "Binary installed to $INSTALL_DIR/$BINARY_NAME"

  # Create config directory
  mkdir -p "$CONFIG_DIR"

  # Generate default config (only if not exists)
  if [[ ! -f "$CONFIG_FILE" ]]; then
    create_default_config
    ok "Config created at $CONFIG_FILE"
  else
    warn "Config already exists at $CONFIG_FILE — preserving"
  fi

  # Install systemd service
  install_service
  ok "Systemd service installed"

  # Enable and start
  systemctl daemon-reload
  systemctl enable --now ovpn-manager
  ok "Service enabled and started"

  echo ""
  info "Installation complete!"
  echo ""

  # Show API key (the binary auto-generates one on first run if empty)
  sleep 2
  if command -v journalctl &>/dev/null; then
    local api_key
    api_key=$(journalctl -u ovpn-manager --no-pager -n 20 2>/dev/null | grep -oP 'Generated API key: \K.*' || true)
    if [[ -n "$api_key" ]]; then
      echo "  API Key: $api_key"
    else
      echo "  API Key: Check config at $CONFIG_FILE or logs with: journalctl -u ovpn-manager"
    fi
  fi
  echo "  Status:  systemctl status ovpn-manager"
  echo "  Logs:    journalctl -u ovpn-manager -f"
  echo ""
}

do_upgrade() {
  local version="$1"
  local arch
  arch=$(detect_arch)

  [[ "$version" == "latest" ]] && version=$(get_latest_version)

  [[ -f "$INSTALL_DIR/$BINARY_NAME" ]] || error "ovpn-manager is not installed. Run '$0 install' first."

  info "Upgrading ovpn-manager to $version..."

  # Download and replace binary
  local tmp
  tmp=$(download_binary "$version" "$arch")
  mv "$tmp" "$INSTALL_DIR/$BINARY_NAME"
  ok "Binary updated"

  # Restart service
  systemctl restart ovpn-manager
  ok "Service restarted"

  echo ""
  info "Upgrade to $version complete!"
  echo ""
}

do_uninstall() {
  info "Uninstalling ovpn-manager..."

  # Stop and disable service
  if systemctl is-active --quiet ovpn-manager 2>/dev/null; then
    systemctl stop ovpn-manager
    ok "Service stopped"
  fi
  if systemctl is-enabled --quiet ovpn-manager 2>/dev/null; then
    systemctl disable ovpn-manager
    ok "Service disabled"
  fi

  # Remove binary
  rm -f "$INSTALL_DIR/$BINARY_NAME"
  ok "Binary removed"

  # Remove service file
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
  ok "Service file removed"

  # Ask about config/data
  echo ""
  read -rp "Remove config and data at $CONFIG_DIR? [y/N] " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    ok "Config and data removed"
  else
    warn "Config and data preserved at $CONFIG_DIR"
  fi

  echo ""
  info "Uninstall complete!"
  echo ""
}

# --- Main ---

main() {
  local command="install"
  local version="latest"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      install|upgrade|uninstall) command="$1"; shift ;;
      --version) version="${2:-}"; [[ -n "$version" ]] || error "--version requires a value"; shift 2 ;;
      --help|-h) usage ;;
      *) error "Unknown option: $1. Use --help for usage." ;;
    esac
  done

  check_root
  check_linux

  case "$command" in
    install)   do_install "$version" ;;
    upgrade)   do_upgrade "$version" ;;
    uninstall) do_uninstall ;;
  esac
}

main "$@"
