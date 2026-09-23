import { Router } from "express";
import { validate } from "../../middleware/validate.ts";
import * as sessionController from "./session.controller.ts";
import {
  createSessionBodySchema,
  listSessionsQuerySchema,
  sessionIdParamsSchema,
} from "./session.http.ts";

/**
 * Wiring and validation. Nothing else — no logic, no data access.
 *
 * Mounted at /api/v1/sessions, so these paths are relative to that.
 */
export const sessionRoutes = Router();

/**
 * Written as the reference for the pattern: method, path, validation
 * middleware, then the controller.
 */
sessionRoutes.post(
  "/",
  validate("body", createSessionBodySchema),
  sessionController.create,
);

sessionRoutes.get(
  "/",
  validate("query", listSessionsQuerySchema),
  sessionController.list,
);

sessionRoutes.get(
  "/:sessionId",
  validate("params", sessionIdParamsSchema),
  sessionController.getById,
);

sessionRoutes.post(
  "/:sessionId/advance",
  validate("params", sessionIdParamsSchema),
  sessionController.advance,
);
