import { z } from "zod";
import { difficultySchema, trackSchema } from "./session.schemas.ts";

/**
 * Request shapes — what a client may send.
 *
 * Separate from `session.schemas.ts`, which describes database rows. These
 * describe untrusted input: a request failing one of these never reaches a
 * controller, so services can assume their arguments are well-formed.
 */

export const createSessionBodySchema = z.object({
  difficulty: difficultySchema,
  track: trackSchema,
});

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

export const sessionIdParamsSchema = z.object({
  sessionId: z.uuid(),
});

export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;

/**
 * Decodes the opaque pagination cursor back into a sort key.
 *
 * The cursor is base64 on purpose: exposing `?after=2026-01-01T…` would let
 * clients depend on the ordering columns, which then cannot change without
 * breaking them. Written here as the reference for the pattern.
 */
export const cursorSchema = z.string().transform((value, ctx) => {
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    const parsed = z.object({ c: z.iso.datetime(), i: z.uuid() }).parse(raw);

    return { createdAt: new Date(parsed.c), id: parsed.i };
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid cursor." });
    return z.NEVER;
  }
});

export const listSessionsQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

/** The matching encoder, used by the controller when building `nextCursor`. */
export function encodeCursor(cursor: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString("base64url");
}
