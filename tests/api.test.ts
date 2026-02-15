import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { initSchema } from "../src/db/schema.ts";
import { authMiddleware } from "../src/middleware/auth.ts";
import { errorHandler } from "../src/middleware/error-handler.ts";
import { auditLogger } from "../src/middleware/logger.ts";
import { instanceRoutes } from "../src/routes/instances.ts";
import { globalStatusRoutes } from "../src/routes/status.ts";
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
  basePaths: {
    serverDir: "/tmp/test-openvpn-server",
    logDir: "/tmp/test-openvpn-log",
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
  app.route("/api/instances", instanceRoutes(TEST_CONFIG));
  app.route("/api/status", globalStatusRoutes(TEST_CONFIG));
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
  const res = await req("/api/instances", { noAuth: true });
  expect(res.status).toBe(401);
});

test("API routes accept valid key", async () => {
  const res = await req("/api/instances");
  expect(res.status).toBe(200);
});

test("API routes reject wrong key", async () => {
  const res = await app.request("/api/instances", {
    headers: { "X-API-Key": "wrong-key" },
  });
  expect(res.status).toBe(401);
});

// ---- Instances ----
test("GET /api/instances returns empty list", async () => {
  const res = await req("/api/instances");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.instances).toEqual([]);
});

test("POST /api/instances creates instance", async () => {
  const res = await req("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "test-instance", displayName: "Test VPN" }),
  });
  expect(res.status).toBe(201);
  const body = await json(res);
  expect(body.name).toBe("test-instance");
  expect(body.display_name).toBe("Test VPN");
  expect(body.status).toBe("setup");
});

test("POST /api/instances rejects duplicate", async () => {
  const res = await req("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "test-instance" }),
  });
  expect(res.status).toBe(409);
});

test("GET /api/instances/:name returns instance", async () => {
  const res = await req("/api/instances/test-instance");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.name).toBe("test-instance");
});

test("GET /api/instances/:name returns 404 for missing", async () => {
  const res = await req("/api/instances/nonexistent");
  expect(res.status).toBe(404);
});

// ---- Server Config (instance-scoped) ----
test("GET /api/instances/:name/server/config returns config", async () => {
  const res = await req("/api/instances/test-instance/server/config");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.hostname).toBe("vpn.example.com");
  expect(body.port).toBe(1194);
  expect(Array.isArray(body.dns)).toBe(true);
});

test("PUT /api/instances/:name/server/config updates config", async () => {
  const res = await req("/api/instances/test-instance/server/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostname: "new-vpn.test.com", maxClients: 50 }),
  });
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.hostname).toBe("new-vpn.test.com");
  expect(body.max_clients).toBe(50);
});

// ---- Setup Status (instance-scoped) ----
test("GET /api/instances/:name/setup/status returns initial state", async () => {
  const res = await req("/api/instances/test-instance/setup/status");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.step).toBe("none");
  expect(body.completed).toBe(0);
});

// ---- Clients (instance-scoped) ----
test("GET /api/instances/:name/clients returns empty list", async () => {
  const res = await req("/api/instances/test-instance/clients");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.clients).toEqual([]);
  expect(body.pagination.total).toBe(0);
});

test("GET /api/instances/:name/clients/:clientName returns 404 for missing", async () => {
  const res = await req("/api/instances/test-instance/clients/nonexistent");
  expect(res.status).toBe(404);
});

// ---- Status (instance-scoped) ----
test("GET /api/instances/:name/status/connections returns empty", async () => {
  const res = await req("/api/instances/test-instance/status/connections");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.connections).toEqual([]);
});

test("GET /api/instances/:name/status/bandwidth returns empty", async () => {
  const res = await req("/api/instances/test-instance/status/bandwidth");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.bandwidth).toEqual([]);
});

test("GET /api/instances/:name/status/connections/history returns empty", async () => {
  const res = await req("/api/instances/test-instance/status/connections/history");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.connections).toEqual([]);
  expect(body.pagination.total).toBe(0);
});

// ---- Global Status ----
test("GET /api/status returns global overview", async () => {
  const res = await req("/api/status");
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.total).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(body.instances)).toBe(true);
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
  expect(names).toContain("instances");
  expect(names).toContain("server_config");
  expect(names).toContain("clients");
  expect(names).toContain("connection_log");
  expect(names).toContain("audit_log");
  expect(names).toContain("setup_state");
});

test("instances table exists and instance was created", () => {
  const row = db.query("SELECT * FROM instances WHERE name = 'test-instance'").get() as any;
  expect(row).not.toBeNull();
  expect(row.name).toBe("test-instance");
});

test("server_config has instance row", () => {
  const inst = db.query("SELECT * FROM instances WHERE name = 'test-instance'").get() as any;
  const row = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(inst.id) as any;
  expect(row).not.toBeNull();
  expect(row.instance_id).toBe(inst.id);
});

// ---- Instance Deletion ----
test("POST second instance for deletion test", async () => {
  const res = await req("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "to-delete" }),
  });
  expect(res.status).toBe(201);
});

test("DELETE /api/instances/:name deletes instance", async () => {
  const res = await req("/api/instances/to-delete", { method: "DELETE" });
  expect(res.status).toBe(200);
  const body = await json(res);
  expect(body.success).toBe(true);

  // Verify it's gone
  const getRes = await req("/api/instances/to-delete");
  expect(getRes.status).toBe(404);
});

// ---- Validation ----
test("POST /api/instances rejects invalid name", async () => {
  const res = await req("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "invalid name!" }),
  });
  expect(res.status).toBe(400);
});
