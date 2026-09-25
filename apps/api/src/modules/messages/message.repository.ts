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

// TODO(raymond): insert a message and return it.
//   Same shape as the other repositories: INSERT ... RETURNING ${COLUMNS},
//   parameterized, then messageRowSchema.parse(rows[0]).
//   Note there is no deleted_at or updated_at on this table.
export async function create(
  db: Queryable,
  input: CreateMessageInput,
): Promise<Message> {
  throw new Error("not implemented");
}

// TODO(raymond): the transcript for one stage — access pattern #2.
//
//   SELECT by stage_id, and make the ordering explicit. Two things to decide:
//     - which column(s) to ORDER BY
//     - why `created_at` alone is not enough
//
//   The index is `idx_messages_stage_created (stage_id, created_at, id)`.
//   Match it and Postgres does an index range scan instead of a sort.
//
//   Returns an array, so map + parse rather than a rowCount guard.
export async function listByStageId(
  db: Queryable,
  stageId: string,
): Promise<Message[]> {
  throw new Error("not implemented");
}

// TODO(raymond): how many messages this stage has.
//
//   The service needs to tell an empty stage from one mid-conversation — the
//   LLM gets an opening prompt in the first case and the history in the second.
//   Loading the whole transcript to call `.length` would work, but this is a
//   count the database can do without sending rows.
//
//   Note: count(*) returns bigint, which `pg` gives you as a *string* to avoid
//   precision loss. Cast it or convert it.
export async function countByStageId(
  db: Queryable,
  stageId: string,
): Promise<number> {
  throw new Error("not implemented");
}
