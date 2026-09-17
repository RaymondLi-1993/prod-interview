import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError.ts";
import { env } from "../config/env.ts";

/**
 * The single place errors become HTTP responses.
 *
 * Nothing above this catches errors to build a response — services throw
 * domain errors, controllers let them propagate, and Express 5 forwards
 * rejected promises here automatically.
 *
 * Responses follow RFC 9457 (`application/problem+json`).
 */

const ERROR_BASE = "https://prod-interview.dev/errors";

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: { path: string; message: string }[];
}

/** 404 for any route that matched nothing. Mounted after all routes. */
export function notFoundHandler(req: Request, res: Response) {
  const body: ProblemDetails = {
    type: `${ERROR_BASE}/not-found`,
    title: "Not Found",
    status: 404,
    detail: `No route matches ${req.method} ${req.path}.`,
    instance: req.originalUrl,
    requestId: req.requestId,
  };

  res.status(404).type("application/problem+json").json(body);
}

/**
 * Express identifies error middleware by arity — it must declare four
 * parameters, even though `next` is unused here.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Headers already sent means a response was streaming when this blew up
  // (SSE, at Level 4). There is no way to change the status now; hand it to
  // Express to destroy the socket.
  if (res.headersSent) {
    _next(err);
    return;
  }

  const body = toProblemDetails(err, req);

  // Never log the error body — it may contain candidate code or transcript
  // text. Log identifiers and the stack, correlated by requestId.
  if (body.status >= 500) {
    console.error(
      `[${req.requestId}] ${req.method} ${req.path} → ${body.status}`,
      err instanceof Error ? err.stack : String(err),
    );
  }

  res.status(body.status).type("application/problem+json").json(body);
}

function toProblemDetails(err: unknown, req: Request): ProblemDetails {
  const base = {
    instance: req.originalUrl,
    requestId: req.requestId,
  };

  // Request validation failed — 400, with the field-level detail clients
  // need to highlight the offending inputs.
  if (err instanceof ZodError) {
    return {
      ...base,
      type: `${ERROR_BASE}/validation-failed`,
      title: "Validation Failed",
      status: 400,
      detail: "The request body or parameters failed validation.",
      errors: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  if (err instanceof AppError) {
    return {
      ...base,
      type: `${ERROR_BASE}/${err.type}`,
      title: titleFor(err.status),
      status: err.status,
      detail: err.expose ? err.message : "An unexpected error occurred.",
    };
  }

  // Anything else is a bug: an unguarded throw, a driver error, a typo. The
  // message could name internal infrastructure, so it never reaches the
  // client outside development.
  return {
    ...base,
    type: `${ERROR_BASE}/internal`,
    title: "Internal Server Error",
    status: 500,
    detail:
      env.NODE_ENV === "development" && err instanceof Error
        ? err.message
        : "An unexpected error occurred.",
  };
}

function titleFor(status: number): string {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Content",
    429: "Too Many Requests",
    500: "Internal Server Error",
  };
  return titles[status] ?? "Error";
}
