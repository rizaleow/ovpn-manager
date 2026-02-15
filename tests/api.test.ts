import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { authMiddleware } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error-handler.ts";
import { auditLogger } from "../src/middleware/logger.ts";
import { setupRoutes } from "../src/routes/setup.ts";
import { serverRoutes } from "../src/routes/server.ts";
import { clientRoutes } from "../src/routes/clients.ts";
import { statusRoutes } from "../src/routes/status.ts";
import { networkRoutes } from "../src/routes/network.ts";
import type { AppConfig } from "../src/types/index.ts";

// In-memory DB + test config
const TEST_CONFIG: AppConfig = {
  listen: { host: "127.0.0.1", port: 0 },
  apiKey: "test-api-key",
  dbPath: ":memory:",
  vpn: {
    hostname: "vpn.test.com",
    port: 1194,
    protocol: "udp",
    devType: "tun",
    subnet: "10.8.0.0",
    subnetMask: "255.255.255.0",
    dns: ["1.1.1.1"],
    cipher: "AES-256-GCM",
  },
  paths: {
    easyrsaDir: "/tmp/test-easyrsa",
    serverConfigPath: "/tmp/test-server.conf",
    statusFile: "/tmp/test-status.log",
    logFile: "/tmp/test-openvpn.log",
    managementSocket: "/tmp/test-mgmt.sock",
    clientConfigDir: "/tmp/test-ccd",
  },
  logLevel: "info",
};

let db: Database;
let app: Hono;

import { setDb } from "../src/db/index.ts";

beforeAll(() => {
  db = new Database(":memory:");
  initSchema(db);
  setDb(db);

  app = new Hono();
  app.onError(errorHandler);
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.use("/api/*", authMiddleware(TEST_CONFIG));
  app.use("/api/*", auditLogger());
  app.route("/api/setup", setupRoutes(TEST_CONFIG));
  app.route("/api/server", serverRoutes(TEST_CONFIG));
  app.route("/api/clients", clientRoutes(TEST_CONFIG));
  app.route("/api/network", networkRoutes(TEST_CONFIG));
  app.route("/api/status", statusRoutes(TEST_CONFIG));
  app.notFound((c) => c.json({ error: "NotFound", message: "Route not found" }, 404));
});

afterAll(() => {
  db.close();
});

function req(path: string, opts?: RequestInit & { noAuth?: boolean }) {
  const headers = new Headers(opts?.headers);
  if (!opts?.noAuth) {
    headers.set("X-API-Key", "test-api-key");
  }
  return app.request(path, { ...opts, headers });
}

async function json(res: Response): Promise<any> {
  return res.json();
}

// ---- Health ----
test("GET /health returns ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.status).toBe("ok");
});

// ---- Auth ----
test("API routes require auth", async () => {
  const res = await req("/api/setup/status", { noAuth: true });
  expect(res.status).toBe(401);
});

test("API routes accept valid key", async () => {
  const res = await req("/api/setup/status");
  expect(res.status).toBe(200);
});

test("API routes reject wrong key", async () => {
  const res = await app.request("/api/setup/status", {
    headers: { "X-API-Key": "wrong-key" },
  });
  expect(res.status).toBe(401);
});

// ---- Setup ----
test("GET /api/setup/status returns initial state", async () => {
  const res = await req("/api/setup/status");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.step).toBe("none");
  expect(body.completed).toBe(0);
});

// ---- Server Config ----
test("GET /api/server/config returns config", async () => {
  const res = await req("/api/server/config");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.hostname).toBe("vpn.example.com");
  expect(body.port).toBe(1194);
  expect(Array.isArray(body.dns)).toBe(true);
});

test("PUT /api/server/config updates config", async () => {
  const res = await req("/api/server/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname: "new-vpn.test.com", maxClients: 50 }),
  });
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.hostname).toBe("new-vpn.test.com");
  expect(body.max_clients).toBe(50);
});

// ---- Clients ----
test("GET /api/clients returns empty list", async () => {
  const res = await req("/api/clients");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.clients).toEqual([]);
  expect(body.pagination.total).toBe(0);
});

test("GET /api/clients/:name returns 404 for missing", async () => {
  const res = await req("/api/clients/nonexistent");
  expect(res.status).toBe(404);
});

// ---- Status ----
test("GET /api/status/connections returns empty", async () => {
  const res = await req("/api/status/connections");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.connections).toEqual([]);
});

test("GET /api/status/bandwidth returns empty", async () => {
  const res = await req("/api/status/bandwidth");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.bandwidth).toEqual([]);
});

test("GET /api/status/connections/history returns empty", async () => {
  const res = await req("/api/status/connections/history");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.connections).toEqual([]);
  expect(body.pagination.total).toBe(0);
});

// ---- 404 ----
test("unknown route returns 404", async () => {
  const res = await app.request("/nonexistent");
  expect(res.status).toBe(404);
  const body = await json(res);
  expect(body.error).toBe("NotFound");
});

// ---- DB Schema ----
test("schema creates all tables", () => {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("server_config");
  expect(names).toContain("clients");
  expect(names).toContain("connection_log");
  expect(names).toContain("audit_log");
  expect(names).toContain("setup_state");
});

test("server_config has singleton row", () => {
  const row = db.query("SELECT * FROM server_config WHERE id = 1").get() as any;
  expect(row).not.toBeNull();
  expect(row.id).toBe(1);
});
