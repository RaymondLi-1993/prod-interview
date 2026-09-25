import { z } from "zod";

/**
 * Row schema for `messages`. Same pattern as the other modules: describe the
 * snake_case row, transform to a camelCase domain object.
 */

export const MESSAGE_ROLES = ["interviewer", "candidate"] as const;

export const messageRoleSchema = z.enum(MESSAGE_ROLES);

export const messageRowSchema = z
  .object({
    // v7 specifically: ordering depends on the id being time-prefixed, so a
    // stray randomUUID() (v4) fails here rather than silently producing rows
    // that sort arbitrarily.
    id: z.uuid({ version: "v7" }),
    stage_id: z.uuid({ version: "v7" }),
    role: messageRoleSchema,
    content: z.string(),
    created_at: z.date(),
  })
  .transform((row) => ({
    id: row.id,
    stageId: row.stage_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));

export type Message = z.output<typeof messageRowSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
