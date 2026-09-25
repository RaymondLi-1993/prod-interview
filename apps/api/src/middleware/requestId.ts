import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates this request across every log line and error response. */
      requestId: string;
    }
  }
}

/**
 * Attaches a request id, honouring an inbound `X-Request-Id` so a trace can
 * span services, and echoes it on the response.
 *
 * This is the thing that makes a production bug report actionable: a user
 * quotes the id from an error, and it matches every log line for that request.
 *
 * Deliberately `randomUUID()` (v4) rather than the `uuidv7()` used for primary
 * keys: request ids are never stored, indexed, or ordered, so the time-ordered
 * prefix buys nothing here.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const inbound = req.get("x-request-id");

  // Never trust an inbound header blindly — an oversized or newline-laden
  // value would poison log lines that include it.
  req.requestId =
    inbound && inbound.length <= 64 && /^[\w.:-]+$/.test(inbound)
      ? inbound
      : randomUUID();

  res.setHeader("x-request-id", req.requestId);
  next();
}
