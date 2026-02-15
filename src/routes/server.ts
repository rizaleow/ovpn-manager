import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateServerConfig } from "../schemas/server.ts";
import { linesQuery } from "../schemas/common.ts";
import { getDb } from "../db/index.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import type { AppConfig } from "../types/index.ts";

export function serverRoutes(config: AppConfig) {
  const app = new Hono();
  const openvpn = new OpenVPNService(config);

  // GET /api/server/config
  app.get("/config", (c) => {
    const db = getDb();
    const row: any = db.query("SELECT * FROM server_config WHERE id = 1").get();
    row.dns = JSON.parse(row.dns);
    return c.json(row);
  });

  // PUT /api/server/config
  app.put("/config", zValidator("json", updateServerConfig), async (c) => {
    const body = c.req.valid("json");
    const db = getDb();

    const updates: string[] = [];
    const values: any[] = [];

    if (body.hostname !== undefined) { updates.push("hostname = ?"); values.push(body.hostname); }
    if (body.port !== undefined) { updates.push("port = ?"); values.push(body.port); }
    if (body.protocol !== undefined) { updates.push("protocol = ?"); values.push(body.protocol); }
    if (body.devType !== undefined) { updates.push("dev_type = ?"); values.push(body.devType); }
    if (body.subnet !== undefined) { updates.push("subnet = ?"); values.push(body.subnet); }
    if (body.subnetMask !== undefined) { updates.push("subnet_mask = ?"); values.push(body.subnetMask); }
    if (body.dns !== undefined) { updates.push("dns = ?"); values.push(JSON.stringify(body.dns)); }
    if (body.cipher !== undefined) { updates.push("cipher = ?"); values.push(body.cipher); }
    if (body.auth !== undefined) { updates.push("auth = ?"); values.push(body.auth); }
    if (body.tlsAuth !== undefined) { updates.push("tls_auth = ?"); values.push(body.tlsAuth ? 1 : 0); }
    if (body.compress !== undefined) { updates.push("compress = ?"); values.push(body.compress); }
    if (body.clientToClient !== undefined) { updates.push("client_to_client = ?"); values.push(body.clientToClient ? 1 : 0); }
    if (body.maxClients !== undefined) { updates.push("max_clients = ?"); values.push(body.maxClients); }
    if (body.keepalive !== undefined) { updates.push("keepalive = ?"); values.push(body.keepalive); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      db.run(`UPDATE server_config SET ${updates.join(", ")} WHERE id = 1`, values);
    }

    // Regenerate and restart
    await openvpn.writeServerConfig();
    try {
      await openvpn.restart();
    } catch {
      // Server may not be running yet
    }

    const row: any = db.query("SELECT * FROM server_config WHERE id = 1").get();
    row.dns = JSON.parse(row.dns);
    return c.json(row);
  });

  // POST /api/server/start
  app.post("/start", async (c) => {
    await openvpn.start();
    return c.json({ success: true, message: "OpenVPN started" });
  });

  // POST /api/server/stop
  app.post("/stop", async (c) => {
    await openvpn.stop();
    return c.json({ success: true, message: "OpenVPN stopped" });
  });

  // POST /api/server/restart
  app.post("/restart", async (c) => {
    await openvpn.restart();
    return c.json({ success: true, message: "OpenVPN restarted" });
  });

  // GET /api/server/status
  app.get("/status", async (c) => {
    const status = await openvpn.getStatus();
    return c.json(status);
  });

  // GET /api/server/logs
  app.get("/logs", zValidator("query", linesQuery), async (c) => {
    const { lines } = c.req.valid("query");
    const logs = await openvpn.getLogs(lines);
    return c.json({ logs });
  });

  // GET /api/server/config/raw
  app.get("/config/raw", async (c) => {
    const file = Bun.file(config.paths.serverConfigPath);
    if (await file.exists()) {
      const content = await file.text();
      return c.text(content);
    }
    return c.json({ error: "Config file not found" }, 404);
  });

  return app;
}
