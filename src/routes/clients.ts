import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createClient, clientListQuery, updateClientConfig } from "../schemas/clients.ts";
import { getDb } from "../db/index.ts";
import { PKIService } from "../services/pki.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import { ProfileService } from "../services/profile.ts";
import { NotFoundError, ConflictError } from "../middleware/error-handler.ts";
import type { AppConfig } from "../types/index.ts";

export function clientRoutes(config: AppConfig) {
  const app = new Hono();
  const pki = new PKIService(config);
  const openvpn = new OpenVPNService(config);
  const profile = new ProfileService(config);

  // GET /api/clients
  app.get("/", zValidator("query", clientListQuery), (c) => {
    const { status, page, limit, search } = c.req.valid("query");
    const db = getDb();
    const offset = (page - 1) * limit;

    let where = "1=1";
    const params: any[] = [];

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

  // POST /api/clients
  app.post("/", zValidator("json", createClient), async (c) => {
    const body = c.req.valid("json");
    const db = getDb();

    // Check for duplicate
    const existing = db.query("SELECT id FROM clients WHERE name = ?").get(body.name);
    if (existing) {
      throw new ConflictError(`Client "${body.name}" already exists`);
    }

    // Generate certificate
    await pki.genClientCert(body.name);

    // Insert into DB
    db.run(
      `INSERT INTO clients (name, email, cert_cn, static_ip, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [body.name, body.email ?? null, body.name, body.staticIp ?? null, body.notes ?? null],
    );

    // Write CCD file if static IP
    if (body.staticIp) {
      await Bun.write(
        `${config.paths.clientConfigDir}/${body.name}`,
        `ifconfig-push ${body.staticIp} ${config.vpn.subnetMask}\n`,
      );
    }

    const client = db.query("SELECT * FROM clients WHERE name = ?").get(body.name);
    return c.json(client, 201);
  });

  // GET /api/clients/:name
  app.get("/:name", (c) => {
    const name = c.req.param("name");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE name = ?").get(name);
    if (!client) throw new NotFoundError(`Client "${name}" not found`);
    return c.json(client);
  });

  // DELETE /api/clients/:name — revoke
  app.delete("/:name", async (c) => {
    const name = c.req.param("name");
    const db = getDb();
    const client: any = db.query("SELECT * FROM clients WHERE name = ?").get(name);
    if (!client) throw new NotFoundError(`Client "${name}" not found`);
    if (client.status === "revoked") {
      return c.json({ message: "Client already revoked" });
    }

    await pki.revokeCert(name);
    db.run("UPDATE clients SET status = 'revoked', revoked_at = datetime('now') WHERE name = ?", [name]);

    // Restart to pick up new CRL
    try {
      await openvpn.restart();
    } catch {
      // Server may not be running
    }

    return c.json({ success: true, message: `Client "${name}" revoked` });
  });

  // GET /api/clients/:name/profile
  app.get("/:name/profile", async (c) => {
    const name = c.req.param("name");
    const db = getDb();
    const client: any = db.query("SELECT * FROM clients WHERE name = ?").get(name);
    if (!client) throw new NotFoundError(`Client "${name}" not found`);
    if (client.status === "revoked") {
      return c.json({ error: "Client is revoked" }, 400);
    }

    const ovpn = await profile.generateProfile(name);
    c.header("Content-Type", "application/x-openvpn-profile");
    c.header("Content-Disposition", `attachment; filename="${name}.ovpn"`);
    return c.body(ovpn);
  });

  // GET /api/clients/:name/config
  app.get("/:name/config", async (c) => {
    const name = c.req.param("name");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE name = ?").get(name);
    if (!client) throw new NotFoundError(`Client "${name}" not found`);

    const ccdPath = `${config.paths.clientConfigDir}/${name}`;
    const file = Bun.file(ccdPath);
    let ccdContent = "";
    if (await file.exists()) {
      ccdContent = await file.text();
    }
    return c.json({ name, config: ccdContent });
  });

  // PUT /api/clients/:name/config
  app.put("/:name/config", zValidator("json", updateClientConfig), async (c) => {
    const name = c.req.param("name");
    const body = c.req.valid("json");
    const db = getDb();
    const client = db.query("SELECT * FROM clients WHERE name = ?").get(name);
    if (!client) throw new NotFoundError(`Client "${name}" not found`);

    const lines: string[] = [];
    if (body.staticIp) {
      lines.push(`ifconfig-push ${body.staticIp} ${config.vpn.subnetMask}`);
      db.run("UPDATE clients SET static_ip = ? WHERE name = ?", [body.staticIp, name]);
    }
    if (body.pushRoutes) {
      for (const route of body.pushRoutes) {
        lines.push(`push "route ${route}"`);
      }
    }

    const ccdPath = `${config.paths.clientConfigDir}/${name}`;
    await Bun.write(ccdPath, lines.join("\n") + "\n");

    return c.json({ success: true, config: lines.join("\n") });
  });

  // POST /api/clients/:name/renew
  app.post("/:name/renew", async (c) => {
    const name = c.req.param("name");
    const db = getDb();
    const client: any = db.query("SELECT * FROM clients WHERE name = ?").get(name);
    if (!client) throw new NotFoundError(`Client "${name}" not found`);

    // Revoke old and regenerate
    try {
      await pki.revokeCert(name);
    } catch {
      // May fail if already revoked
    }
    await pki.genClientCert(name);

    db.run("UPDATE clients SET status = 'active', revoked_at = NULL, created_at = datetime('now') WHERE name = ?", [name]);

    return c.json({ success: true, message: `Client "${name}" certificate renewed` });
  });

  return app;
}
