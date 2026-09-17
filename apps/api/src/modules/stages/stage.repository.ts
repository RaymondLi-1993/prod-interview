import { randomUUID } from "node:crypto";
import type { Queryable } from "../../db/types.ts";
import { STAGE_KINDS, stageRowSchema, type Stage } from "./stage.schemas.ts";

/** SQL only. Same rules as session.repository.ts. */

const COLUMNS = `
  id, session_id, kind, position, status,
  started_at, completed_at, working_state, created_at, updated_at
`;

/**
 * Creates all four stages for a new session in one statement.
 *
 * The first is `active` with a start time; the rest are `pending`. A single
 * multi-row INSERT rather than four round trips — and since this always runs
 * inside the same transaction as the session insert, either all five rows
 * exist or none do.
 */
export async function createForSession(
  db: Queryable,
  sessionId: string,
): Promise<Stage[]> {
  const values: unknown[] = [];
  const tuples = STAGE_KINDS.map((kind, i) => {
    const base = i * 6;
    values.push(
      randomUUID(),
      sessionId,
      kind,
      i + 1,
      i === 0 ? "active" : "pending",
      // The first stage starts the moment the session does; the rest have not
      // begun. Set here rather than in a follow-up UPDATE so the rows this
      // returns match what is stored.
      i === 0 ? new Date() : null,
    );
    return `($${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)}, $${String(base + 4)}, $${String(base + 5)}, $${String(base + 6)})`;
  });

  const { rows } = await db.query(
    `INSERT INTO session_stages
       (id, session_id, kind, position, status, started_at)
     VALUES ${tuples.join(", ")}
     RETURNING ${COLUMNS}`,
    values,
  );

  return rows.map((row) => stageRowSchema.parse(row));
}

/** All stages for a session, in order. Backed by UNIQUE (session_id, position). */
export async function listBySessionId(
  db: Queryable,
  sessionId: string,
): Promise<Stage[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM session_stages
     WHERE session_id = $1
     ORDER BY position`,
    [sessionId],
  );

  return rows.map((row) => stageRowSchema.parse(row));
}

/**
 * The resume lookup — backed by `uq_stages_one_active_per_session`, which also
 * guarantees at most one row can match.
 */
export async function findActiveBySessionId(
  db: Queryable,
  sessionId: string,
): Promise<Stage | null> {
  const { rows, rowCount } = await db.query(
    `SELECT ${COLUMNS} FROM session_stages
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId],
  );

  return rowCount ? stageRowSchema.parse(rows[0]) : null;
}
