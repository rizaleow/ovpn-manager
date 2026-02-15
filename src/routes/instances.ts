import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createInstance } from "../schemas/instances.ts";
import { setupRequest } from "../schemas/setup.ts";
import { updateServerConfig } from "../schemas/server.ts";
import { createClient, clientListQuery, updateClientConfig } from "../schemas/clients.ts";
import { addIptablesRule, updateForwarding, updateRoutes } from "../schemas/network.ts";
import { paginationQuery, linesQuery } from "../schemas/common.ts";
import { getDb } from "../db/index.ts";
import { InstanceService } from "../services/instance.ts";
import { PKIService } from "../services/pki.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import { NetworkService } from "../services/network.ts";
import { ProfileService } from "../services/profile.ts";
import { StatusMonitor } from "../services/status-monitor.ts";
import { NotFoundError, ConflictError, ServiceError } from "../middleware/error-handler.ts";
import type { AppConfig, Instance } from "../types/index.ts";
import { exec } from "../utils/shell.ts";

function resolveInstance(instanceService: InstanceService, name: string): Instance {
  const instance = instanceService.get(name);
  if (!instance) throw new NotFoundError(`Instance "${name}" not found`);
  return instance;
}

export function instanceRoutes(config: AppConfig) {
  const app = new Hono();
  const instanceService = new InstanceService(config);

  // ---- Instance CRUD ----

  // GET /api/instances
  app.get("/", (c) => {
    const instances = instanceService.list();
    return c.json({ instances });
  });

  // POST /api/instances
  app.post("/", zValidator("json", createInstance), async (c) => {
    const body = c.req.valid("json");
    const existing = instanceService.get(body.name);
    if (existing) throw new ConflictError(`Instance "${body.name}" already exists`);

    const instance = await instanceService.create(body.name, body.displayName);
    return c.json(instance, 201);
  });

  // GET /api/instances/:name
  app.get("/:name", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    return c.json(instance);
  });

  // DELETE /api/instances/:name
  app.delete("/:name", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    await instanceService.delete(instance.name);
    return c.json({ success: true, message: `Instance "${instance.name}" deleted` });
  });

  // ---- Setup (per instance) ----

  // POST /api/instances/:name/setup
  app.post("/:name/setup", zValidator("json", setupRequest), async (c) => {
    const body = c.req.valid("json");
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();

    const state: any = db.query("SELECT * FROM setup_state WHERE instance_id = ?").get(instance.id);
    if (state?.completed) {
      return c.json({ error: "Setup already completed for this instance" }, 409);
    }

    db.run("UPDATE setup_state SET started_at = datetime('now'), step = 'none', error = NULL WHERE instance_id = ?", [instance.id]);

    const pki = new PKIService(instance);
    const openvpn = new OpenVPNService(instance);
    const network = new NetworkService(instance);

    try {
      // Step 1: Install packages
      db.run("UPDATE setup_state SET step = 'packages_installed' WHERE instance_id = ?", [instance.id]);
      await exec(["apt-get", "update", "-y"]);
      await exec(["apt-get", "install", "-y", "openvpn", "easy-rsa", "iptables-persistent"]);

      // Step 2: Initialize PKI
      db.run("UPDATE setup_state SET step = 'pki_initialized' WHERE instance_id = ?", [instance.id]);
      await pki.initPKI();
      await pki.buildCA();
      await pki.genServerCert();
      await pki.genDH();
      await pki.genTLSAuth();
      await pki.genCRL();

      // Step 3: Configure server
      db.run("UPDATE setup_state SET step = 'server_configured' WHERE instance_id = ?", [instance.id]);
      db.run(
        `UPDATE server_config SET
          hostname = ?, protocol = ?, port = ?, dev_type = ?,
          subnet = ?, subnet_mask = ?, dns = ?, cipher = ?,
          pki_initialized = 1, updated_at = datetime('now')
        WHERE instance_id = ?`,
        [
          body.hostname,
          body.protocol,
          body.port,
          body.devType,
          body.subnet,
          body.subnetMask,
          JSON.stringify(body.dns),
          body.cipher,
          instance.id,
        ],
      );
      await openvpn.writeServerConfig();

      // Create CCD directory
      const { mkdirSync } = await import("node:fs");
      mkdirSync(instance.ccd_dir, { recursive: true });

      // Step 4: Network
      db.run("UPDATE setup_state SET step = 'network_configured' WHERE instance_id = ?", [instance.id]);
      await network.enableForwarding();
      await network.setupNAT(body.subnet, body.subnetMask);
      await network.persistIptables();

      // Step 5: Start
      db.run("UPDATE setup_state SET step = 'running' WHERE instance_id = ?", [instance.id]);
      await openvpn.enable();
      await openvpn.start();

      // Done
      db.run("UPDATE setup_state SET completed = 1, completed_at = datetime('now') WHERE instance_id = ?", [instance.id]);
      instanceService.updateStatus(instance.name, "active");

      return c.json({ success: true, message: `Instance "${instance.name}" setup completed` });
    } catch (err: any) {
      db.run("UPDATE setup_state SET error = ? WHERE instance_id = ?", [err.message, instance.id]);
      instanceService.updateStatus(instance.name, "error");
      throw new ServiceError("Setup failed", err.message);
    }
  });

  // GET /api/instances/:name/setup/status
  app.get("/:name/setup/status", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();
    const state = db.query("SELECT * FROM setup_state WHERE instance_id = ?").get(instance.id);
    return c.json(state);
  });

  // ---- Server Config & Control ----

  // GET /api/instances/:name/server/config
  app.get("/:name/server/config", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();
    const row: any = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(instance.id);
    row.dns = JSON.parse(row.dns);
    return c.json(row);
  });

  // PUT /api/instances/:name/server/config
  app.put("/:name/server/config", zValidator("json", updateServerConfig), async (c) => {
    const body = c.req.valid("json");
    const instance = resolveInstance(instanceService, c.req.param("name"));
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
      db.run(`UPDATE server_config SET ${updates.join(", ")} WHERE instance_id = ?`, [...values, instance.id]);
    }

    const openvpn = new OpenVPNService(instance);
    await openvpn.writeServerConfig();
    try { await openvpn.restart(); } catch {}

    const row: any = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(instance.id);
    row.dns = JSON.parse(row.dns);
    return c.json(row);
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

  // ---- Clients ----

  // GET /api/instances/:name/clients
  app.get("/:name/clients", zValidator("query", clientListQuery), (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const { status, page, limit, search } = c.req.valid("query");
    const db = getDb();
    const offset = (page - 1) * limit;

    let where = "instance_id = ?";
    const params: any[] = [instance.id];

    if (status) {
      where += " AND status = ?";
      params.push(status);
    }
    if (search) {
      where += " AND (name LIKE ? OR email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const rows = db.query(`SELECT * FROM clients WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = (db.query(`SELECT COUNT(*) as count FROM clients WHERE ${where}`).get(...params) as any).count;

    return c.json({
      clients: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // POST /api/instances/:name/clients
  app.post("/:name/clients", zValidator("json", createClient), async (c) => {
    const body = c.req.valid("json");
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();

    const existing = db.query("SELECT id FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, body.name);
    if (existing) throw new ConflictError(`Client "${body.name}" already exists in this instance`);

    const pki = new PKIService(instance);
    await pki.genClientCert(body.name);

    db.run(
      `INSERT INTO clients (instance_id, name, email, cert_cn, static_ip, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [instance.id, body.name, body.email ?? null, body.name, body.staticIp ?? null, body.notes ?? null],
    );

    if (body.staticIp) {
      const serverConfig: any = db.query("SELECT subnet_mask FROM server_config WHERE instance_id = ?").get(instance.id);
      await Bun.write(
        `${instance.ccd_dir}/${body.name}`,
        `ifconfig-push ${body.staticIp} ${serverConfig.subnet_mask}\n`,
      );
    }

    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, body.name);
    return c.json(client, 201);
  });

  // GET /api/instances/:name/clients/:clientName
  app.get("/:name/clients/:clientName", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);
    return c.json(client);
  });

  // DELETE /api/instances/:name/clients/:clientName
  app.delete("/:name/clients/:clientName", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const db = getDb();
    const client: any = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);
    if (client.status === "revoked") {
      return c.json({ message: "Client already revoked" });
    }

    const pki = new PKIService(instance);
    await pki.revokeCert(clientName);
    db.run("UPDATE clients SET status = 'revoked', revoked_at = datetime('now') WHERE instance_id = ? AND name = ?", [instance.id, clientName]);

    const openvpn = new OpenVPNService(instance);
    try { await openvpn.restart(); } catch {}

    return c.json({ success: true, message: `Client "${clientName}" revoked` });
  });

  // GET /api/instances/:name/clients/:clientName/profile
  app.get("/:name/clients/:clientName/profile", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const db = getDb();
    const client: any = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);
    if (client.status === "revoked") {
      return c.json({ error: "Client is revoked" }, 400);
    }

    const profile = new ProfileService(instance);
    const ovpn = await profile.generateProfile(clientName);
    c.header("Content-Type", "application/x-openvpn-profile");
    c.header("Content-Disposition", `attachment; filename="${clientName}.ovpn"`);
    return c.body(ovpn);
  });

  // GET /api/instances/:name/clients/:clientName/config
  app.get("/:name/clients/:clientName/config", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);

    const ccdPath = `${instance.ccd_dir}/${clientName}`;
    const file = Bun.file(ccdPath);
    let ccdContent = "";
    if (await file.exists()) {
      ccdContent = await file.text();
    }
    return c.json({ name: clientName, config: ccdContent });
  });

  // PUT /api/instances/:name/clients/:clientName/config
  app.put("/:name/clients/:clientName/config", zValidator("json", updateClientConfig), async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const body = c.req.valid("json");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);

    const serverConfig: any = db.query("SELECT subnet_mask FROM server_config WHERE instance_id = ?").get(instance.id);
    const lines: string[] = [];
    if (body.staticIp) {
      lines.push(`ifconfig-push ${body.staticIp} ${serverConfig.subnet_mask}`);
      db.run("UPDATE clients SET static_ip = ? WHERE instance_id = ? AND name = ?", [body.staticIp, instance.id, clientName]);
    }
    if (body.pushRoutes) {
      for (const route of body.pushRoutes) {
        lines.push(`push "route ${route}"`);
      }
    }

    const ccdPath = `${instance.ccd_dir}/${clientName}`;
    await Bun.write(ccdPath, lines.join("\n") + "\n");

    return c.json({ success: true, config: lines.join("\n") });
  });

  // POST /api/instances/:name/clients/:clientName/renew
  app.post("/:name/clients/:clientName/renew", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const db = getDb();
    const client: any = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);

    const pki = new PKIService(instance);
    try { await pki.revokeCert(clientName); } catch {}
    await pki.genClientCert(clientName);

    db.run("UPDATE clients SET status = 'active', revoked_at = NULL, created_at = datetime('now') WHERE instance_id = ? AND name = ?", [instance.id, clientName]);

    return c.json({ success: true, message: `Client "${clientName}" certificate renewed` });
  });

  // ---- Network ----

  // GET /api/instances/:name/network/iptables
  app.get("/:name/network/iptables", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const network = new NetworkService(instance);
    const nat = await network.listNATRules();
    const forward = await network.listForwardRules();
    return c.json({ nat, forward });
  });

  // POST /api/instances/:name/network/iptables
  app.post("/:name/network/iptables", zValidator("json", addIptablesRule), async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const body = c.req.valid("json");
    const network = new NetworkService(instance);
    await network.addIptablesRule(body);
    await network.persistIptables();
    return c.json({ success: true, message: "Rule added" }, 201);
  });

  // DELETE /api/instances/:name/network/iptables/:id
  app.delete("/:name/network/iptables/:id", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const ruleNum = parseInt(c.req.param("id"), 10);
    const network = new NetworkService(instance);
    await network.deleteNATRule(ruleNum);
    await network.persistIptables();
    return c.json({ success: true, message: "Rule deleted" });
  });

  // GET /api/instances/:name/network/forwarding
  app.get("/:name/network/forwarding", async (c) => {
    resolveInstance(instanceService, c.req.param("name"));
    const network = new NetworkService();
    const enabled = await network.getForwardingStatus();
    return c.json({ enabled });
  });

  // PUT /api/instances/:name/network/forwarding
  app.put("/:name/network/forwarding", zValidator("json", updateForwarding), async (c) => {
    resolveInstance(instanceService, c.req.param("name"));
    const { enabled } = c.req.valid("json");
    const network = new NetworkService();
    if (enabled) {
      await network.enableForwarding();
    } else {
      await network.disableForwarding();
    }
    return c.json({ success: true, enabled });
  });

  // GET /api/instances/:name/network/interfaces
  app.get("/:name/network/interfaces", async (c) => {
    resolveInstance(instanceService, c.req.param("name"));
    const network = new NetworkService();
    const raw = await network.listInterfaces();
    const interfaces = JSON.parse(raw);
    return c.json({ interfaces });
  });

  // GET /api/instances/:name/network/routes
  app.get("/:name/network/routes", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const configFile = Bun.file(instance.config_path);
    const routes: { network: string; netmask: string }[] = [];
    if (await configFile.exists()) {
      const content = await configFile.text();
      const routeRegex = /push "route (\S+) (\S+)"/g;
      let match;
      while ((match = routeRegex.exec(content)) !== null) {
        routes.push({ network: match[1]!, netmask: match[2]! });
      }
    }
    return c.json({ routes });
  });

  // PUT /api/instances/:name/network/routes
  app.put("/:name/network/routes", zValidator("json", updateRoutes), async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const { routes } = c.req.valid("json");
    const configFile = Bun.file(instance.config_path);
    if (await configFile.exists()) {
      let content = await configFile.text();
      content = content.replace(/push "route [^"]+"\n?/g, "");
      const routeLines = routes.map((r: { network: string; netmask: string }) => `push "route ${r.network} ${r.netmask}"`).join("\n");
      if (routeLines) {
        content = content.trimEnd() + "\n" + routeLines + "\n";
      }
      await Bun.write(instance.config_path, content);
    }

    const openvpn = new OpenVPNService(instance);
    try { await openvpn.restart(); } catch {}

    return c.json({ success: true, routes });
  });

  // ---- Status (per instance) ----

  // GET /api/instances/:name/status
  app.get("/:name/status", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const openvpn = new OpenVPNService(instance);
    const monitor = new StatusMonitor(instance);

    const [active, connections, bandwidth] = await Promise.all([
      openvpn.isActive(),
      monitor.getActiveConnections(),
      monitor.getBandwidthStats(),
    ]);

    return c.json({
      server: { active, connections: connections.length },
      activeConnections: connections,
      bandwidthSummary: bandwidth.slice(0, 10),
    });
  });

  // GET /api/instances/:name/status/connections
  app.get("/:name/status/connections", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const monitor = new StatusMonitor(instance);
    const connections = await monitor.getActiveConnections();
    await monitor.recordSnapshot();
    return c.json({ connections });
  });

  // GET /api/instances/:name/status/connections/history
  app.get("/:name/status/connections/history", zValidator("query", paginationQuery), async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const { page, limit } = c.req.valid("query");
    const monitor = new StatusMonitor(instance);
    const { rows, total } = await monitor.getConnectionHistory(page, limit);
    return c.json({
      connections: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // GET /api/instances/:name/status/bandwidth
  app.get("/:name/status/bandwidth", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const monitor = new StatusMonitor(instance);
    const stats = await monitor.getBandwidthStats();
    return c.json({ bandwidth: stats });
  });

  return app;
}
