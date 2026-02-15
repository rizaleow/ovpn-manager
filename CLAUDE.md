# OpenVPN Manager

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

Tests live in `tests/`. Use in-memory SQLite + `setDb()` from `src/db/index.ts` to inject a test DB.
Hono's `app.request()` is used for HTTP-level testing without starting a real server.

## Commands

```bash
bun run dev          # Start dev server with hot reload
bun run build        # Compile to single binary (native)
bun run build:linux  # Cross-compile for Linux x64
bun test             # Run tests
```

## Architecture

Backend-only REST API. No frontend.

- **Framework:** Hono + @hono/zod-validator + Zod
- **Database:** bun:sqlite (WAL mode, singleton via `src/db/index.ts`)
- **Shell commands:** `src/utils/shell.ts` wraps `Bun.$` / `Bun.spawn`

```
src/
  index.ts          # Entrypoint — config, DB init, Hono app, Bun.serve
  config.ts         # JSON config loader (CLI flag → env → default path)
  db/               # SQLite schema + singleton
  middleware/       # Auth (X-API-Key), error handler, audit logger
  routes/           # Hono route groups (setup, server, clients, network, status)
  services/         # Business logic (pki, openvpn, network, profile, status-monitor)
  schemas/          # Zod validation schemas
  types/            # Shared TypeScript types
  utils/            # Shell command wrapper
```

## Gotchas

- Must run as root on Linux (needs systemctl, iptables, sysctl access)
- Config path: `--config <path>` flag → `OVPN_MANAGER_CONFIG` env → `/etc/ovpn-manager/config.json`
- API key auto-generates on first run if empty in config
- All `/api/*` routes require `X-API-Key` header; `/health` is unauthenticated
- EasyRSA is called with `--batch` flag (non-interactive)
- Server config changes via PUT `/api/server/config` auto-rewrite `server.conf` and restart OpenVPN
