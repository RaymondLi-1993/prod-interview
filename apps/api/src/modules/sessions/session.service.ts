import { randomUUID } from "node:crypto";
import { pool } from "../../db/pool.ts";
import { withTransaction } from "../../db/transaction.ts";
import { ConflictError, NotFoundError } from "../../errors/AppError.ts";
import type { Stage } from "../stages/stage.schemas.ts";
import * as sessionRepository from "./session.repository.ts";
import * as stageRepository from "../stages/stage.repository.ts";
import type { Difficulty, Session, Track } from "./session.schemas.ts";

/**
 * Business logic for interview sessions.
 *
 * This layer must never import from `express` or reference `req`/`res`. It
 * takes typed arguments and throws typed errors; something else decides what
 * those mean over HTTP.
 *
 * It is also where **authorization** lives. Authentication (who are you?) is
 * the middleware's job. Whether *this* user may touch *this* session is a
 * business rule, and it is enforced here so it cannot be bypassed by a route
 * that forgot to check.
 */

export interface SessionWithStages {
  session: Session;
  stages: Stage[];
}

/** Postgres unique-violation. Raised by the partial unique indexes. */
const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === UNIQUE_VIOLATION
  );
}

/**
 * Starts a new interview: one `sessions` row plus four `session_stages` rows,
 * with the introduction stage already active.
 *
 * All five rows must land together — a session with two stages is permanently
 * broken and only discovered when someone tries to resume it.
 */
export async function createSession(input: {
  userId: string;
  track: Track;
  difficulty: Difficulty;
}): Promise<SessionWithStages> {
  const isExisting = await sessionRepository.findActiveByUserId(
    pool,
    input.userId,
  );
  if (isExisting) {
    throw new ConflictError("A session already exists");
  }

  try {
    return await withTransaction(async (txConnection) => {
      const session = await sessionRepository.create(txConnection, {
        id: randomUUID(),
        userId: input.userId,
        track: input.track,
        difficulty: input.difficulty,
      });

      const stages = await stageRepository.createForSession(
        txConnection,
        session.id,
      );
      return { session, stages };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError("You already have an interview in progress");
    }
    throw err;
  }
}

/**
 * Loads a session the user owns, with its stages.
 *
 * Used for resume: the client gets the session, every stage's status, and the
 * active stage's working state in one call.
 */
export async function getSession(
  sessionId: string,
  userId: string,
): Promise<SessionWithStages> {
  const session = await sessionRepository.findById(pool, sessionId);

  if (!session || session.userId !== userId) {
    throw new NotFoundError("Session", sessionId);
  }

  const stages = await stageRepository.listBySessionId(pool, sessionId);

  return { session, stages };
}

/**
 * Advances the interview: completes the active stage and activates the next.
 *
 * The final stage completing ends the session.
 */
export async function advanceSession(
  sessionId: string,
  userId: string,
): Promise<SessionWithStages> {
  // TODO(raymond): the state machine. Leave this until createSession and
  // getSession are working and tested.
  //
  //   - which transitions are legal, and which must be rejected?
  //   - advancing a session that is already completed → which error?
  //   - two concurrent advance requests: what stops both from activating the
  //     same next stage? (uq_stages_one_active_per_session, Postgres 23505)
  //   - completing the last stage should also end the session. Remember
  //     chk_sessions_ended_at requires ended_at whenever status is not
  //     'in_progress'.
  //   - all of it in one transaction.
  throw new Error("not implemented");
}

/**
 * The user's sessions, newest first, keyset-paginated.
 *
 * Written as the reference for the pattern: no branching, no ownership check
 * needed (the query filters by user), just a pass-through with a cursor.
 */
export async function listSessions(
  userId: string,
  limit: number,
  cursor?: { createdAt: Date; id: string },
): Promise<Session[]> {
  return sessionRepository.listByUserId(pool, userId, limit, cursor);
}
