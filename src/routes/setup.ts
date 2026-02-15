import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { setupRequest } from "../schemas/setup.ts";
import { getDb } from "../db/index.ts";
import { PKIService } from "../services/pki.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import { NetworkService } from "../services/network.ts";
import { ServiceError } from "../middleware/error-handler.ts";
import type { AppConfig } from "../types/index.ts";
import { exec } from "../utils/shell.ts";

export function setupRoutes(config: AppConfig) {
  const app = new Hono();
  const pki = new PKIService(config);
  const openvpn = new OpenVPNService(config);
  const network = new NetworkService();

  // POST /api/setup — full bootstrap
  app.post("/", zValidator("json", setupRequest), async (c) => {
    const body = c.req.valid("json");
    const db = getDb();

    const state: any = db.query("SELECT * FROM setup_state WHERE id = 1").get();
    if (state.completed) {
      return c.json({ error: "Setup already completed" }, 409);
    }

    db.run("UPDATE setup_state SET started_at = datetime('now'), step = 'none', error = NULL WHERE id = 1");

    try {
      // Step 1: Install packages
      db.run("UPDATE setup_state SET step = 'packages_installed' WHERE id = 1");
      await exec(["apt-get", "update", "-y"]);
      await exec(["apt-get", "install", "-y", "openvpn", "easy-rsa", "iptables-persistent"]);

      // Step 2: Initialize PKI
      db.run("UPDATE setup_state SET step = 'pki_initialized' WHERE id = 1");
      await pki.initPKI();
      await pki.buildCA();
      await pki.genServerCert();
      await pki.genDH();
      await pki.genTLSAuth();
      await pki.genCRL();

      // Step 3: Configure server
      db.run("UPDATE setup_state SET step = 'server_configured' WHERE id = 1");
      db.run(
        `UPDATE server_config SET
          hostname = ?, protocol = ?, port = ?, dev_type = ?,
          subnet = ?, subnet_mask = ?, dns = ?, cipher = ?,
          pki_initialized = 1, updated_at = datetime('now')
        WHERE id = 1`,
        [
          body.hostname,
          body.protocol,
          body.port,
          body.devType,
          body.subnet,
          body.subnetMask,
          JSON.stringify(body.dns),
          body.cipher,
        ],
      );
      await openvpn.writeServerConfig();

      // Create CCD directory
      const { mkdirSync } = await import("node:fs");
      mkdirSync(config.paths.clientConfigDir, { recursive: true });

      // Step 4: Network
      db.run("UPDATE setup_state SET step = 'network_configured' WHERE id = 1");
      await network.enableForwarding();
      await network.setupNAT(body.subnet, body.subnetMask);
      await network.persistIptables();

      // Step 5: Start
      db.run("UPDATE setup_state SET step = 'running' WHERE id = 1");
      await openvpn.enable();
      await openvpn.start();

      // Done
      db.run("UPDATE setup_state SET completed = 1, completed_at = datetime('now') WHERE id = 1");

      return c.json({ success: true, message: "OpenVPN setup completed successfully" });
    } catch (err: any) {
      db.run("UPDATE setup_state SET error = ? WHERE id = 1", [err.message]);
      throw new ServiceError("Setup failed", err.message);
    }
  });

  // GET /api/setup/status
  app.get("/status", (c) => {
    const db = getDb();
    const state = db.query("SELECT * FROM setup_state WHERE id = 1").get();
    return c.json(state);
  });

  return app;
}
