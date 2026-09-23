import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.ts";
import { UnauthorizedError } from "../errors/AppError.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The authenticated user's id. Set by exactly one auth middleware. */
      userId: string;
    }
  }
}

/**
 * The auth seam, stubbed.
 *
 * Real authentication arrives later: verify a provider-issued JWT, read its
 * `sub`, and resolve it to a local user via
 * `userRepository.findUserByProvider`. Until then this resolves the seeded
 * development user so the rest of the stack can be built and exercised.
 *
 * Everything downstream reads `req.userId` and is unaffected by the swap —
 * which is the entire point of putting the seam in now. Authorization
 * (*may this user touch this resource?*) is business logic and lives in the
 * service layer regardless.
 */

const DEV_EMAIL = "dev@prod-interview.local";

let cachedUserId: string | undefined;

export async function devUser(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    cachedUserId ??= await resolveDevUserId();
    req.userId = cachedUserId;
    next();
  } catch (err) {
    next(err);
  }
}

async function resolveDevUserId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [DEV_EMAIL],
  );

  const id = rows[0]?.id;
  if (!id) {
    throw new UnauthorizedError(
      `No development user found. Run \`npm run seed\` to create ${DEV_EMAIL}.`,
    );
  }

  return id;
}
