import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createInstance } from "../../schemas/instances.ts";
import { InstanceService } from "../../services/instance.ts";
import { ConflictError } from "../../middleware/error-handler.ts";
import type { AppConfig } from "../../types/index.ts";
import { resolveInstance } from "./helpers.ts";
import { setupRoutes } from "./setup.ts";
import { serverRoutes } from "./server.ts";
import { clientRoutes } from "./clients.ts";
import { networkRoutes } from "./network.ts";
import { statusRoutes } from "./status.ts";

export function instanceRoutes(config: AppConfig) {
  const app = new Hono();
  const instanceService = new InstanceService(config);

  // ---- Instance CRUD ----

  // GET /api/instances
  app.get("/", (c) => {
    const instances = instanceService.list();
    return c.json({ instances });
  });

  // POST /api/instances
  app.post("/", zValidator("json", createInstance), async (c) => {
    const body = c.req.valid("json");
    const existing = instanceService.get(body.name);
    if (existing) throw new ConflictError(`Instance "${body.name}" already exists`);

    const instance = await instanceService.create(body.name, body.displayName);
    return c.json(instance, 201);
  });

  // GET /api/instances/:name
  app.get("/:name", (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    return c.json(instance);
  });

  // DELETE /api/instances/:name
  app.delete("/:name", async (c) => {
    const instance = resolveInstance(instanceService, c.req.param("name"));
    await instanceService.delete(instance.name);
    return c.json({ success: true, message: `Instance "${instance.name}" deleted` });
  });

  // Mount sub-routes
  app.route("/", setupRoutes(config, instanceService));
  app.route("/", serverRoutes(config, instanceService));
  app.route("/", clientRoutes(config, instanceService));
  app.route("/", networkRoutes(config, instanceService));
  app.route("/", statusRoutes(config, instanceService));

  return app;
}
