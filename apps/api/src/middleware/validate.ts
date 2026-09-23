import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/**
 * Validates one part of the request against a schema, replacing it with the
 * parsed result so downstream code gets coerced, typed values.
 *
 * A failure throws a `ZodError`, which the error middleware already turns into
 * a 400 carrying field-level detail — so validation needs no error handling of
 * its own.
 */
type RequestPart = "body" | "params" | "query";

export function validate(part: RequestPart, schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed: unknown = schema.parse(req[part]);

      // Express 5 makes req.query a getter, so it cannot be assigned directly.
      Object.defineProperty(req, part, {
        value: parsed,
        writable: true,
        configurable: true,
      });

      next();
    } catch (err) {
      next(err);
    }
  };
}
