import { z } from "zod";

/**
 * Row schemas describe what Postgres actually returns — snake_case, dates as
 * `Date` objects — and `.transform()` them into camelCase domain objects.
 *
 * One schema does both jobs, so the shape of a row is described in exactly one
 * place. If a migration renames a column, the mapping changes here and nowhere
 * else.
 *
 * Validation is not paranoia about Postgres. It catches the realistic failure:
 * a migration changes a column and the TypeScript type still claims the old
 * shape. Without a runtime check, that mismatch surfaces later as `undefined`
 * somewhere unrelated.
 */

export const TRACKS = ["frontend", "react", "backend"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const SESSION_STATUSES = [
  "in_progress",
  "completed",
  "abandoned",
] as const;

export const trackSchema = z.enum(TRACKS);
export const difficultySchema = z.enum(DIFFICULTIES);
export const sessionStatusSchema = z.enum(SESSION_STATUSES);

/** Mirrors the `sessions` table. Column names, column types. */
export const sessionRowSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    track: trackSchema,
    difficulty: difficultySchema,
    status: sessionStatusSchema,
    ended_at: z.date().nullable(),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    userId: row.user_id,
    track: row.track,
    difficulty: row.difficulty,
    status: row.status,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }));

/**
 * The domain object every layer above the repository sees.
 * No snake_case escapes the repository (see README: Design notes).
 */
export type Session = z.output<typeof sessionRowSchema>;

export type Track = z.infer<typeof trackSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
