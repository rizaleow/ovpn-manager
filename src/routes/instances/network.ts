import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { addIptablesRule, updateForwarding, updateRoutes } from "../../schemas/network.ts";
import { InstanceService } from "../../services/instance.ts";
import { NetworkService } from "../../services/network.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import type { AppConfig } from "../../types/index.ts";
import { resolveInstance } from "./helpers.ts";

export function networkRoutes(config: AppConfig, instanceService: InstanceService) {
  const app = new Hono();

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
    if (isNaN(ruleNum)) {
      return c.json({ error: "Invalid rule ID" }, 400);
    }
    const network = new NetworkService(instance);
    await network.deleteNATRule(ruleNum);
    await network.persistIptables();
    return c.json({ success: true, message: "Rule deleted" });
  });

  // GET /api/instances/:name/network/forwarding
  app.get("/:name/network/forwarding", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const network = new NetworkService(instance);
    const enabled = await network.getForwardingStatus();
    return c.json({ enabled });
  });

  // PUT /api/instances/:name/network/forwarding
  app.put("/:name/network/forwarding", zValidator("json", updateForwarding), async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const network = new NetworkService(instance);
    const { enabled } = c.req.valid("json");
    if (enabled) {
      await network.enableForwarding();
    } else {
      await network.disableForwarding();
    }
    return c.json({ success: true, enabled });
  });

  // GET /api/instances/:name/network/interfaces
  app.get("/:name/network/interfaces", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    const network = new NetworkService(instance);
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
    try { await openvpn.restart(); } catch (err) {
      console.error("Failed to restart OpenVPN after route update:", err);
    }

    return c.json({ success: true, routes });
  });

  return app;
}
