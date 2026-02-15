import { Hono } from "hono";
import { loadConfig } from "../config.ts";
import { initDb, closeDb } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { errorHandler } from "../middleware/error-handler.ts";
import { auditLogger } from "../middleware/logger.ts";
import { instanceRoutes } from "../routes/instances.ts";
import { globalStatusRoutes } from "../routes/status.ts";

export async function startServer(configPath?: string): Promise<void> {
  const config = await loadConfig(configPath);
  initDb(config.dbPath);

  const app = createApp(config);

  const server = Bun.serve({
    fetch: app.fetch,
    port: config.listen.port,
    hostname: config.listen.host,
  });

  console.log(`OpenVPN Manager running at http://${server.hostname}:${server.port}`);
  console.log(`API key: ${config.apiKey}`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    closeDb();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    closeDb();
    process.exit(0);
  });
}

export function createApp(config: import("../types/index.ts").AppConfig): Hono {
  const app = new Hono();

  // Global error handler
  app.onError(errorHandler);

  // Health check (no auth)
  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Auth + audit for all /api routes
  app.use("/api/*", authMiddleware(config));
  app.use("/api/*", auditLogger());

  // Mount routes
  app.route("/api/instances", instanceRoutes(config));
  app.route("/api/status", globalStatusRoutes(config));

  // 404 fallback
  app.notFound((c) => {
    return c.json({ error: "NotFound", message: "Route not found" }, 404);
  });

  return app;
}
