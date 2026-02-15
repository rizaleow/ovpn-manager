import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { addIptablesRule, updateForwarding, updateRoutes } from "../schemas/network.ts";
import { NetworkService } from "../services/network.ts";
import { getDb } from "../db/index.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import type { AppConfig } from "../types/index.ts";

export function networkRoutes(config: AppConfig) {
  const app = new Hono();
  const network = new NetworkService();
  const openvpn = new OpenVPNService(config);

  // GET /api/network/iptables
  app.get("/iptables", async (c) => {
    const nat = await network.listNATRules();
    const forward = await network.listForwardRules();
    return c.json({ nat, forward });
  });

  // POST /api/network/iptables
  app.post("/iptables", zValidator("json", addIptablesRule), async (c) => {
    const body = c.req.valid("json");
    await network.addIptablesRule(body);
    await network.persistIptables();
    return c.json({ success: true, message: "Rule added" }, 201);
  });

  // DELETE /api/network/iptables/:id
  app.delete("/iptables/:id", async (c) => {
    const ruleNum = parseInt(c.req.param("id"), 10);
    await network.deleteNATRule(ruleNum);
    await network.persistIptables();
    return c.json({ success: true, message: "Rule deleted" });
  });

  // GET /api/network/forwarding
  app.get("/forwarding", async (c) => {
    const enabled = await network.getForwardingStatus();
    return c.json({ enabled });
  });

  // PUT /api/network/forwarding
  app.put("/forwarding", zValidator("json", updateForwarding), async (c) => {
    const { enabled } = c.req.valid("json");
    if (enabled) {
      await network.enableForwarding();
    } else {
      await network.disableForwarding();
    }
    return c.json({ success: true, enabled });
  });

  // GET /api/network/interfaces
  app.get("/interfaces", async (c) => {
    const raw = await network.listInterfaces();
    const interfaces = JSON.parse(raw);
    return c.json({ interfaces });
  });

  // GET /api/network/routes
  app.get("/routes", async (c) => {
    const db = getDb();
    const row: any = db.query("SELECT * FROM server_config WHERE id = 1").get();
    // Parse routes from current server config
    const configFile = Bun.file(config.paths.serverConfigPath);
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

  // PUT /api/network/routes
  app.put("/routes", zValidator("json", updateRoutes), async (c) => {
    const { routes } = c.req.valid("json");
    // Regenerate server config with updated routes
    // For now, update the config file and restart
    const configFile = Bun.file(config.paths.serverConfigPath);
    if (await configFile.exists()) {
      let content = await configFile.text();
      // Remove existing push route lines
      content = content.replace(/push "route [^"]+"\n?/g, "");
      // Add new routes before the last line
      const routeLines = routes.map((r: { network: string; netmask: string }) => `push "route ${r.network} ${r.netmask}"`).join("\n");
      if (routeLines) {
        content = content.trimEnd() + "\n" + routeLines + "\n";
      }
      await Bun.write(config.paths.serverConfigPath, content);
    }

    try {
      await openvpn.restart();
    } catch {
      // Server may not be running
    }

    return c.json({ success: true, routes });
  });

  return app;
}
