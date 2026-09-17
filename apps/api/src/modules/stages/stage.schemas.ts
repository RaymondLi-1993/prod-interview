import { z } from "zod";

/**
 * Row schema for `session_stages`. Same pattern as session.schemas.ts:
 * describe the snake_case row, transform to a camelCase domain object.
 */

/** Fixed order. Position in this array is the stage's `position` (1-based). */
export const STAGE_KINDS = [
  "introduction",
  "coding",
  "system_design",
  "behavioral",
] as const;

export const STAGE_STATUSES = ["pending", "active", "completed"] as const;

export const stageKindSchema = z.enum(STAGE_KINDS);
export const stageStatusSchema = z.enum(STAGE_STATUSES);

export const stageRowSchema = z
  .object({
    id: z.string().uuid(),
    session_id: z.string().uuid(),
    kind: stageKindSchema,
    position: z.number().int(),
    status: stageStatusSchema,
    started_at: z.date().nullable(),
    completed_at: z.date().nullable(),
    working_state: z.record(z.string(), z.unknown()),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform((row) => ({
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    position: row.position,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    workingState: row.working_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

export type Stage = z.output<typeof stageRowSchema>;
export type StageKind = z.infer<typeof stageKindSchema>;
export type StageStatus = z.infer<typeof stageStatusSchema>;
