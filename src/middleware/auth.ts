import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../types/index.ts";

export function authMiddleware(config: AppConfig) {
  return createMiddleware(async (c, next) => {
    const apiKey = c.req.header("X-API-Key");
    if (!apiKey || apiKey !== config.apiKey) {
      return c.json({ error: "Unauthorized", message: "Invalid or missing API key" }, 401);
    }
    await next();
  });
}
