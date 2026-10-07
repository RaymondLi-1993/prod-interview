import type { Queryable } from "../../db/types.ts";
import {
  messageRowSchema,
  type Message,
  type MessageRole,
} from "./message.schemas.ts";

/**
 * SQL only.
 *
 * Simpler than the other repositories, for two reasons that follow from the
 * schema: messages are never edited (no `updated_at`) and never soft-deleted
 * (no `deleted_at` filter) — they cascade away with their session.
 */

const COLUMNS = `id, stage_id, role, content, created_at`;

export interface CreateMessageInput {
  id: string;
  stageId: string;
  role: MessageRole;
  content: string;
}

/**
 * No explicit transaction: a single statement is already atomic. The `db`
 * parameter is a `Queryable`, so the caller decides whether this runs inside
 * one — and an interview turn deliberately does not, because that would hold a
 * pooled connection open across the LLM call.
 */
export async function create(
  db: Queryable,
  input: CreateMessageInput,
): Promise<Message> {
  const { rows } = await db.query(
    `INSERT INTO messages (id, stage_id, role, content)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.id, input.stageId, input.role, input.content],
  );

  return messageRowSchema.parse(rows[0]);
}

/**
 * The transcript for one stage, oldest first — access pattern #2.
 *
 * Matches `idx_messages_stage_created (stage_id, created_at, id)`: equality on
 * the leading column seeks straight to this stage's block, and the rows are
 * already in `created_at, id` order inside it, so there is no sort step.
 * `stage_id` is absent from the ORDER BY on purpose — the WHERE has pinned it
 * to one value, so it can no longer order anything.
 *
 * `id` as the tiebreaker only works because ids are UUIDv7. `now()` is
 * evaluated once per transaction, so messages written together share a
 * `created_at` and the ordering falls entirely to the key; a random v4 would
 * put them in arbitrary order.
 *
 * Mapping rather than indexing means an empty stage returns `[]` instead of
 * throwing — the normal state at the start of every stage.
 */
export async function listByStageId(
  db: Queryable,
  stageId: string,
): Promise<Message[]> {
  const { rows } = await db.query(
    `
        SELECT ${COLUMNS} FROM messages
        WHERE stage_id = $1
        ORDER BY created_at, id
      `,
    [stageId],
  );

  return rows.map((elem) => messageRowSchema.parse(elem));
}
