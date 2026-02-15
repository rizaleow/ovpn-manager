import { createMiddleware } from "hono/factory";
import { getDb } from "../db/index.ts";

export function auditLogger() {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

    // Log to console
    console.log(`${method} ${path} ${status} ${duration}ms`);

    // Log to audit_log for mutating operations
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      try {
        const db = getDb();
        db.run(
          `INSERT INTO audit_log (action, resource, resource_id, details, ip_address, success)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            method,
            path,
            null,
            JSON.stringify({ status, duration }),
            ip,
            status < 400 ? 1 : 0,
          ],
        );
      } catch (err) {
        console.error("Audit log write failed:", err);
      }
    }
  });
}
