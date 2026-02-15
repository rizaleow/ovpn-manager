import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { paginationQuery } from "../schemas/common.ts";
import { StatusMonitor } from "../services/status-monitor.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import type { AppConfig } from "../types/index.ts";
import { exec } from "../utils/shell.ts";

export function statusRoutes(config: AppConfig) {
  const app = new Hono();
  const monitor = new StatusMonitor(config);
  const openvpn = new OpenVPNService(config);

  // GET /api/status — full overview
  app.get("/", async (c) => {
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

  // GET /api/status/connections
  app.get("/connections", async (c) => {
    const connections = await monitor.getActiveConnections();
    // Also record a snapshot
    await monitor.recordSnapshot();
    return c.json({ connections });
  });

  // GET /api/status/connections/history
  app.get("/connections/history", zValidator("query", paginationQuery), async (c) => {
    const { page, limit } = c.req.valid("query");
    const { rows, total } = await monitor.getConnectionHistory(page, limit);
    return c.json({
      connections: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // GET /api/status/bandwidth
  app.get("/bandwidth", async (c) => {
    const stats = await monitor.getBandwidthStats();
    return c.json({ bandwidth: stats });
  });

  // GET /api/status/system
  app.get("/system", async (c) => {
    const [loadavg, meminfo, diskUsage] = await Promise.all([
      Bun.file("/proc/loadavg").text().catch(() => "N/A"),
      Bun.file("/proc/meminfo").text().catch(() => "N/A"),
      exec(["df", "-h", "/"]).catch(() => "N/A"),
    ]);

    const uptime = await exec(["uptime", "-p"]).catch(() => "N/A");

    return c.json({
      loadavg: loadavg.trim(),
      memory: parseMeminfo(meminfo),
      disk: diskUsage,
      uptime: uptime.trim(),
    });
  });

  return app;
}

function parseMeminfo(raw: string): { total: string; available: string; used: string } {
  if (raw === "N/A") return { total: "N/A", available: "N/A", used: "N/A" };
  const lines = raw.split("\n");
  const get = (key: string) => {
    const line = lines.find((l) => l.startsWith(key));
    return line?.split(/\s+/)[1] ?? "0";
  };
  const totalKb = parseInt(get("MemTotal:"), 10);
  const availKb = parseInt(get("MemAvailable:"), 10);
  const usedKb = totalKb - availKb;
  const fmt = (kb: number) => `${(kb / 1024).toFixed(0)} MB`;
  return { total: fmt(totalKb), available: fmt(availKb), used: fmt(usedKb) };
}
