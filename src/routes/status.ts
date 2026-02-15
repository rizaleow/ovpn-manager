import { Hono } from "hono";
import { getDb } from "../db/index.ts";
import { InstanceService } from "../services/instance.ts";
import { OpenVPNService } from "../services/openvpn.ts";
import { StatusMonitor } from "../services/status-monitor.ts";
import type { AppConfig, Instance } from "../types/index.ts";
import { exec } from "../utils/shell.ts";

export function globalStatusRoutes(config: AppConfig) {
  const app = new Hono();
  const instanceService = new InstanceService(config);

  // GET /api/status — Global overview across all instances
  app.get("/", async (c) => {
    const instances = instanceService.list();
    const results = await Promise.all(
      instances.map(async (instance) => {
        const openvpn = new OpenVPNService(instance);
        const monitor = new StatusMonitor(instance);
        const [active, connections] = await Promise.all([
          openvpn.isActive(),
          monitor.getActiveConnections(),
        ]);
        return {
          name: instance.name,
          displayName: instance.display_name,
          status: instance.status,
          active,
          connections: connections.length,
        };
      }),
    );

    return c.json({
      instances: results,
      total: instances.length,
      activeCount: results.filter((r) => r.active).length,
      totalConnections: results.reduce((sum, r) => sum + r.connections, 0),
    });
  });

  // GET /api/status/system — System-level info
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
