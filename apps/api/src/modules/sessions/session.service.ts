import { pool } from "../../db/pool.ts";
import { uuidv7 } from "../../db/uuid.ts";
import { withTransaction as withTransactionImpl } from "../../db/transaction.ts";
import type { Queryable } from "../../db/types.ts";
import { ConflictError, NotFoundError } from "../../errors/AppError.ts";
import type { Stage } from "../stages/stage.schemas.ts";
import * as stageRepository from "../stages/stage.repository.ts";
import * as sessionRepository from "./session.repository.ts";
import type { SessionServiceDeps } from "./session.deps.ts";
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
 * business rule, enforced here so it cannot be bypassed by a route that forgot
 * to check.
 *
 * Dependencies arrive through `createSessionService` rather than being imported
 * directly, so a unit test can substitute in-memory fakes and run without a
 * database. The real instance is constructed at the bottom of this file.
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

// ───────────────────────────────────────────────────────────────────────────
// The factory. Everything inside closes over `deps`, so the function bodies
// reference `deps.sessionRepository` instead of an imported module.
// ───────────────────────────────────────────────────────────────────────────

export function createSessionService(deps: SessionServiceDeps) {
  const { db, withTransaction, sessionRepository, stageRepository } = deps;

  /**
   * Loads a session, or throws if it does not exist **or does not belong to
   * this user**. Both cases raise the same `NotFoundError`, so a caller cannot
   * tell a real id from a fake one by comparing responses.
   *
   * Every entry point that touches a session goes through here. Duplicating
   * this check is how one endpoint eventually ships without it — a data leak,
   * not a style problem.
   *
   * Takes an explicit `Queryable` rather than using `db`, so callers inside a
   * transaction can pass `txConnection` and have the read share that snapshot.
   *
   * Deliberately does **not** check status: viewing a finished session is
   * legal, advancing one is not.
   */
  async function loadOwnedSession(
    conn: Queryable,
    sessionId: string,
    userId: string,
  ): Promise<Session> {
    const session = await sessionRepository.findById(conn, sessionId);

    if (!session || session.userId !== userId) {
      throw new NotFoundError("Session", sessionId);
    }

    return session;
  }

  /**
   * Starts a new interview: one `sessions` row plus four `session_stages`
   * rows, with the introduction stage already active.
   *
   * All five rows must land together — a session with two stages is
   * permanently broken and only discovered when someone tries to resume it.
   */
  async function createSession(input: {
    userId: string;
    track: Track;
    difficulty: Difficulty;
  }): Promise<SessionWithStages> {
    const isExisting = await sessionRepository.findActiveByUserId(
      db,
      input.userId,
    );
    if (isExisting) {
      throw new ConflictError(
        "You already have an interview in progress. Finish or end it before starting another.",
      );
    }

    try {
      return await withTransaction(async (txConnection) => {
        const session = await sessionRepository.create(txConnection, {
          id: uuidv7(),
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
        throw new ConflictError(
          "You already have an interview in progress. Finish or end it before starting another.",
        );
      }
      throw err;
    }
  }

  /**
   * Loads a session the user owns, with its stages. Used for resume.
   */
  async function getSession(
    sessionId: string,
    userId: string,
  ): Promise<SessionWithStages> {
    const session = await loadOwnedSession(db, sessionId, userId);
    const stages = await stageRepository.listBySessionId(db, sessionId);

    return { session, stages };
  }

  /**
   * Advances the interview: completes the active stage and activates the next.
   * The final stage completing ends the session.
   */
  async function advanceSession(
    sessionId: string,
    userId: string,
  ): Promise<SessionWithStages> {
    try {
      return await withTransaction(async (txConnection) => {
        let session = await loadOwnedSession(txConnection, sessionId, userId);
        if (session.status !== "in_progress") {
          throw new ConflictError(
            "This interview has already ended and cannot be advanced.",
          );
        }

        const active = await stageRepository.findActiveBySessionId(
          txConnection,
          sessionId,
        );
        if (!active) {
          // Should be unreachable: an in-progress session always has exactly
          // one active stage, per uq_stages_one_active_per_session.
          throw new ConflictError(
            "This interview has no stage in progress. Please reload and try again.",
          );
        }

        // write
        await stageRepository.completeStage(txConnection, active.id);

        const next = await stageRepository.activateStage(
          txConnection,
          session.id,
          active.position + 1,
        );

        if (!next) {
          const ended = await sessionRepository.endSession(
            txConnection,
            sessionId,
          );
          if (ended) {
            session = ended;
          }
        }

        const stages = await stageRepository.listBySessionId(
          txConnection,
          sessionId,
        );

        return { session, stages };
      });
    } catch (err) {
      if (isUniqueViolation(err))
        // Another request advanced this session first; its write won the race
        // on uq_stages_one_active_per_session.
        throw new ConflictError(
          "This interview was already advanced. Please reload to see the current stage.",
        );
      throw err;
    }
  }

  /** The user's sessions, newest first, keyset-paginated. */
  async function listSessions(
    userId: string,
    limit: number,
    cursor?: { createdAt: Date; id: string },
  ): Promise<Session[]> {
    return sessionRepository.listByUserId(db, userId, limit, cursor);
  }

  return { createSession, getSession, advanceSession, listSessions };
}

export type SessionService = ReturnType<typeof createSessionService>;

// ───────────────────────────────────────────────────────────────────────────
// The production instance. The only place the real pool and repositories are
// named — controllers import this and are unaware of the factory.
// ───────────────────────────────────────────────────────────────────────────

export const sessionService = createSessionService({
  db: pool,
  withTransaction: withTransactionImpl,
  sessionRepository,
  stageRepository,
});
