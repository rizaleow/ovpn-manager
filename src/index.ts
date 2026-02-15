import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import { initDb, closeDb } from "./db/index.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { auditLogger } from "./middleware/logger.ts";
import { setupRoutes } from "./routes/setup.ts";
import { serverRoutes } from "./routes/server.ts";
import { clientRoutes } from "./routes/clients.ts";
import { networkRoutes } from "./routes/network.ts";
import { statusRoutes } from "./routes/status.ts";

const config = await loadConfig();
const db = initDb(config.dbPath);

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
app.route("/api/setup", setupRoutes(config));
app.route("/api/server", serverRoutes(config));
app.route("/api/clients", clientRoutes(config));
app.route("/api/network", networkRoutes(config));
app.route("/api/status", statusRoutes(config));

// 404 fallback
app.notFound((c) => {
  return c.json({ error: "NotFound", message: "Route not found" }, 404);
});

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
