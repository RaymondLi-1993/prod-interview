import type { Queryable } from "../../db/types.js";
import {
  sessionRowSchema,
  type Difficulty,
  type Session,
  type Track,
} from "./session.schemas.js";

/**
 * SQL, and only SQL (CLAUDE.md section 4).
 *
 * No business logic, no branching on domain rules, no knowledge that HTTP
 * exists. Every method takes a `Queryable` as its first argument so it works
 * standalone or inside a transaction without knowing which.
 *
 * Every row is parsed through a Zod schema before it leaves this file, so
 * callers receive validated camelCase domain objects and never see a raw row.
 */

/** Explicit column list — never `SELECT *` (CLAUDE.md section 6). */
const COLUMNS = `
  id, user_id, track, difficulty, status,
  ended_at, created_at, updated_at, deleted_at
`;

export interface CreateSessionInput {
  id: string;
  userId: string;
  track: Track;
  difficulty: Difficulty;
}

export async function create(
  db: Queryable,
  input: CreateSessionInput,
): Promise<Session> {
  const { rows } = await db.query(
    `INSERT INTO sessions (id, user_id, track, difficulty)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.id, input.userId, input.track, input.difficulty],
  );

  // A failed INSERT throws; it never returns zero rows. If this is ever
  // undefined the database contract is broken, and the parse below says so.
  return sessionRowSchema.parse(rows[0]);
}

/**
 * Soft-deleted rows are excluded here rather than by callers — forgetting
 * `deleted_at IS NULL` once is a data leak, so it lives in the SQL.
 */
export async function findById(
  db: Queryable,
  id: string,
): Promise<Session | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM sessions
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );

  return rows.length > 0 ? sessionRowSchema.parse(rows[0]) : null;
}

/**
 * The resume query — access pattern #1. Backed by
 * `uq_sessions_one_active_per_user`, which also guarantees at most one row.
 */
export async function findActiveByUserId(
  db: Queryable,
  userId: string,
): Promise<Session | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM sessions
     WHERE user_id = $1 AND status = 'in_progress' AND deleted_at IS NULL`,
    [userId],
  );

  return rows.length > 0 ? sessionRowSchema.parse(rows[0]) : null;
}

/**
 * Keyset pagination — access pattern #3. Never OFFSET: it forces Postgres to
 * scan and discard, and concurrent inserts shift the window so users see
 * duplicates or skips.
 *
 * The cursor is the last row's `(createdAt, id)`. UUIDv7 makes `id` a
 * meaningful tiebreaker, and the column order matches
 * `idx_sessions_user_created` exactly so this is an index range scan.
 */
export interface ListCursor {
  createdAt: Date;
  id: string;
}

export async function listByUserId(
  db: Queryable,
  userId: string,
  limit: number,
  cursor?: ListCursor,
): Promise<Session[]> {
  const { rows } = cursor
    ? await db.query(
        `SELECT ${COLUMNS} FROM sessions
         WHERE user_id = $1 AND deleted_at IS NULL
           AND (created_at, id) < ($2, $3)
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [userId, cursor.createdAt, cursor.id, limit],
      )
    : await db.query(
        `SELECT ${COLUMNS} FROM sessions
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [userId, limit],
      );

  return rows.map((row) => sessionRowSchema.parse(row));
}
