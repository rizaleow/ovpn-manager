import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { setupRequest } from "../../schemas/setup.ts";
import { getDb } from "../../db/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { PKIService } from "../../services/pki.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import { NetworkService } from "../../services/network.ts";
import { ServiceError } from "../../middleware/error-handler.ts";
import type { AppConfig, Instance } from "../../types/index.ts";
import { exec } from "../../utils/shell.ts";
import { resolveInstance } from "./helpers.ts";

interface SetupState {
  completed: number;
  step: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export function setupRoutes(config: AppConfig, instanceService: InstanceService) {
  const app = new Hono();

  // POST /api/instances/:name/setup
  app.post("/:name/setup", zValidator("json", setupRequest), async (c) => {
    const body = c.req.valid("json");
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();

    const state = db.query("SELECT * FROM setup_state WHERE instance_id = ?").get(instance.id) as SetupState | null;
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.run("UPDATE setup_state SET error = ? WHERE instance_id = ?", [message, instance.id]);
      instanceService.updateStatus(instance.name, "error");
      throw new ServiceError("Setup failed", message);
    }
  });

  // GET /api/instances/:name/setup/status
  app.get("/:name/setup/status", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const db = getDb();
    const state = db.query("SELECT * FROM setup_state WHERE instance_id = ?").get(instance.id);
    return c.json(state);
  });

  return app;
}
