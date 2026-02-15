import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { paginationQuery } from "../../schemas/common.ts";
import { InstanceService } from "../../services/instance.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import { StatusMonitor } from "../../services/status-monitor.ts";
import type { AppConfig } from "../../types/index.ts";
import { resolveInstance } from "./helpers.ts";

export function statusRoutes(config: AppConfig, instanceService: InstanceService) {
  const app = new Hono();

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
