import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createClient, clientListQuery, updateClientConfig } from "../../schemas/clients.ts";
import { getDb } from "../../db/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { PKIService } from "../../services/pki.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import { ProfileService } from "../../services/profile.ts";
import { NotFoundError, ConflictError } from "../../middleware/error-handler.ts";
import type { AppConfig, Client } from "../../types/index.ts";
import { resolveInstance } from "./helpers.ts";

interface ServerConfigRow {
  subnet_mask: string;
}

export function clientRoutes(config: AppConfig, instanceService: InstanceService) {
  const app = new Hono();

  // GET /api/instances/:name/clients
  app.get("/:name/clients", zValidator("query", clientListQuery), (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const { status, page, limit, search } = c.req.valid("query");
    const db = getDb();
    const offset = (page - 1) * limit;

    let where = "instance_id = ?";
    const params: (string | number)[] = [instance.id];

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
    const total = (db.query(`SELECT COUNT(*) as count FROM clients WHERE ${where}`).get(...params) as { count: number }).count;

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
      const serverConfig = db.query("SELECT subnet_mask FROM server_config WHERE instance_id = ?").get(instance.id) as ServerConfigRow;
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
    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName) as Client | null;
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);
    if (client.status === "revoked") {
      return c.json({ message: "Client already revoked" });
    }

    const pki = new PKIService(instance);
    await pki.revokeCert(clientName);
    db.run("UPDATE clients SET status = 'revoked', revoked_at = datetime('now') WHERE instance_id = ? AND name = ?", [instance.id, clientName]);

    const openvpn = new OpenVPNService(instance);
    try { await openvpn.restart(); } catch (err) {
      console.error("Failed to restart OpenVPN after client revocation:", err);
    }

    return c.json({ success: true, message: `Client "${clientName}" revoked` });
  });

  // GET /api/instances/:name/clients/:clientName/profile
  app.get("/:name/clients/:clientName/profile", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const clientName = c.req.param("clientName");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName) as Client | null;
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

    const serverConfig = db.query("SELECT subnet_mask FROM server_config WHERE instance_id = ?").get(instance.id) as ServerConfigRow;
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
    const client = db.query("SELECT * FROM clients WHERE instance_id = ? AND name = ?").get(instance.id, clientName);
    if (!client) throw new NotFoundError(`Client "${clientName}" not found`);

    const pki = new PKIService(instance);
    try { await pki.revokeCert(clientName); } catch (err) {
      console.warn(`Could not revoke old cert for ${clientName} (may not exist):`, err);
    }
    await pki.genClientCert(clientName);

    db.run("UPDATE clients SET status = 'active', revoked_at = NULL, created_at = datetime('now') WHERE instance_id = ? AND name = ?", [instance.id, clientName]);

    return c.json({ success: true, message: `Client "${clientName}" certificate renewed` });
  });

  return app;
}
