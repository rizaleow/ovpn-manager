# OpenVPN Manager

REST API for managing a local OpenVPN server and its clients on Linux (Debian/Ubuntu). Handles the full lifecycle: installing OpenVPN, initializing PKI, generating client profiles, managing firewall rules, and monitoring connections.

Compiles to a single binary for easy deployment.

## Requirements

- Linux (Debian/Ubuntu)
- Bun v1.3+
- Root access (for systemctl, iptables, sysctl)

## Install

```bash
bun install
```

## Development

```bash
bun run dev
```

## Build

```bash
# Native binary
bun run build

# Cross-compile for Linux x64
bun run build:linux
```

Produces a self-contained binary at `dist/ovpn-manager`.

## Configuration

Config is resolved from (in order): `--config <path>` flag, `OVPN_MANAGER_CONFIG` env var, or `/etc/ovpn-manager/config.json`.

Copy `config.example.json` to get started. If `apiKey` is empty, one is auto-generated on first run.

## Usage

```bash
# Run the binary
sudo ./dist/ovpn-manager --config /etc/ovpn-manager/config.json

# Health check (no auth)
curl http://127.0.0.1:3000/health

# Bootstrap the server
curl -X POST http://127.0.0.1:3000/api/setup \
  -H "X-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"hostname": "vpn.example.com"}'

# Create a client
curl -X POST http://127.0.0.1:3000/api/clients \
  -H "X-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"name": "alice"}'

# Download .ovpn profile
curl http://127.0.0.1:3000/api/clients/alice/profile \
  -H "X-API-Key: <key>" -o alice.ovpn
```

## API

All `/api/*` routes require an `X-API-Key` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| POST | `/api/setup` | Full bootstrap wizard |
| GET | `/api/setup/status` | Setup progress |
| GET | `/api/server/config` | Server configuration |
| PUT | `/api/server/config` | Update config |
| POST | `/api/server/start` | Start OpenVPN |
| POST | `/api/server/stop` | Stop OpenVPN |
| POST | `/api/server/restart` | Restart OpenVPN |
| GET | `/api/server/status` | Service status |
| GET | `/api/server/logs` | Tail logs |
| GET | `/api/server/config/raw` | Raw server.conf |
| GET | `/api/clients` | List clients |
| POST | `/api/clients` | Create client |
| GET | `/api/clients/:name` | Client details |
| DELETE | `/api/clients/:name` | Revoke client |
| GET | `/api/clients/:name/profile` | Download .ovpn |
| GET | `/api/clients/:name/config` | Client-specific config |
| PUT | `/api/clients/:name/config` | Update client config |
| POST | `/api/clients/:name/renew` | Renew certificate |
| GET | `/api/network/iptables` | List firewall rules |
| POST | `/api/network/iptables` | Add rule |
| DELETE | `/api/network/iptables/:id` | Remove rule |
| GET | `/api/network/forwarding` | IP forwarding status |
| PUT | `/api/network/forwarding` | Toggle forwarding |
| GET | `/api/network/interfaces` | List interfaces |
| GET | `/api/network/routes` | Pushed routes |
| PUT | `/api/network/routes` | Update routes |
| GET | `/api/status` | Full overview |
| GET | `/api/status/connections` | Active connections |
| GET | `/api/status/connections/history` | Connection history |
| GET | `/api/status/bandwidth` | Bandwidth stats |
| GET | `/api/status/system` | System info |

## Testing

```bash
bun test
```
