import express from "express";
import { requestId } from "./middleware/requestId.ts";
import { devUser } from "./middleware/devUser.ts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.ts";
import { sessionRoutes } from "./modules/sessions/session.routes.ts";
import { pool } from "./db/pool.ts";

/**
 * Express app assembly. Wiring only — no route logic lives here.
 *
 * Middleware order is significant:
 *   1. requestId   — everything below it can log a correlation id
 *   2. body parser — routes need a parsed body
 *   3. devUser     — the auth seam; routes read req.userId
 *   4. routes
 *   5. notFound    — nothing matched
 *   6. errorHandler — must be last, and must take four arguments
 */
export function createApp() {
  const app = express();

  // Trust the first proxy hop so req.ip is the client, not a load balancer.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(express.json({ limit: "1mb" }));

  /**
   * Liveness and readiness are different questions. This answers readiness:
   * can we actually serve traffic, which requires the database. Deliberately
   * above the auth middleware — a health check must not need credentials.
   */
  app.get("/health", (_req, res, next) => {
    pool
      .query("SELECT 1")
      .then(() => res.json({ status: "ok" }))
      .catch(next);
  });

  app.use(devUser);

  app.use("/api/v1/sessions", sessionRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
