import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateServerConfig } from "../../schemas/server.ts";
import { linesQuery } from "../../schemas/common.ts";
import { getDb } from "../../db/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import type { AppConfig } from "../../types/index.ts";
import { resolveInstance } from "./helpers.ts";

interface ServerConfig {
  id: number;
  instance_id: number;
  hostname: string;
  protocol: string;
  port: number;
  dev_type: string;
  subnet: string;
  subnet_mask: string;
  dns: string;
  cipher: string;
  auth: string;
  tls_auth: number;
  compress: string;
  client_to_client: number;
  max_clients: number;
  keepalive: string;
  pki_initialized: number;
  created_at: string;
  updated_at: string;
}

export function serverRoutes(config: AppConfig, instanceService: InstanceService) {
  const app = new Hono();

  // GET /api/instances/:name/server/config
  app.get("/:name/server/config", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();
    const row = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(instance.id) as ServerConfig;
    return c.json({ ...row, dns: JSON.parse(row.dns) });
  });

  // PUT /api/instances/:name/server/config
  app.put("/:name/server/config", zValidator("json", updateServerConfig), async (c) => {
    const body = c.req.valid("json");
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();

    const updates: string[] = [];
    const values: (string | number)[] = [];

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
      db.run(`UPDATE server_config SET ${updates.join(", ")} WHERE instance_id = ?`, [...values, instance.id]);
    }

    const openvpn = new OpenVPNService(instance);
    await openvpn.writeServerConfig();
    try { await openvpn.restart(); } catch (err) {
      console.error("Failed to restart OpenVPN after config update:", err);
    }

    const row = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(instance.id) as ServerConfig;
    return c.json({ ...row, dns: JSON.parse(row.dns) });
  });

  // POST /api/instances/:name/server/start
  app.post("/:name/server/start", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const openvpn = new OpenVPNService(instance);
    await openvpn.start();
    instanceService.updateStatus(instance.name, "active");
    return c.json({ success: true, message: "OpenVPN started" });
  });

  // POST /api/instances/:name/server/stop
  app.post("/:name/server/stop", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const openvpn = new OpenVPNService(instance);
    await openvpn.stop();
    instanceService.updateStatus(instance.name, "inactive");
    return c.json({ success: true, message: "OpenVPN stopped" });
  });

  // POST /api/instances/:name/server/restart
  app.post("/:name/server/restart", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const openvpn = new OpenVPNService(instance);
    await openvpn.restart();
    return c.json({ success: true, message: "OpenVPN restarted" });
  });

  // GET /api/instances/:name/server/status
  app.get("/:name/server/status", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const openvpn = new OpenVPNService(instance);
    const status = await openvpn.getStatus();
    return c.json(status);
  });

  // GET /api/instances/:name/server/logs
  app.get("/:name/server/logs", zValidator("query", linesQuery), async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const { lines } = c.req.valid("query");
    const openvpn = new OpenVPNService(instance);
    const logs = await openvpn.getLogs(lines);
    return c.json({ logs });
  });

  // GET /api/instances/:name/server/config/raw
  app.get("/:name/server/config/raw", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const file = Bun.file(instance.config_path);
    if (await file.exists()) {
      const content = await file.text();
      return c.text(content);
    }
    return c.json({ error: "Config file not found" }, 404);
  });

  return app;
}
