import type { Queryable } from "../../db/types.ts";
import type { Stage } from "../stages/stage.schemas.ts";
import type { Session } from "./session.schemas.ts";
import type { CreateSessionInput, ListCursor } from "./session.repository.ts";

/**
 * What the session service depends on, stated as interfaces rather than
 * concrete imports.
 *
 * This is the **architectural seam** — the line a test substitutes across. The
 * service is written against these shapes, so production passes the real
 * repositories and a unit test passes in-memory fakes. Neither the service nor
 * its tests reference a module path, which is why a file move cannot silently
 * break a test (CLAUDE.md section 7: mock at seams, never at library
 * boundaries).
 *
 * Every method takes a `Queryable` first, so the same implementation works
 * standalone or inside a transaction.
 */

export interface SessionRepo {
  create(db: Queryable, input: CreateSessionInput): Promise<Session>;
  findById(db: Queryable, id: string): Promise<Session | null>;
  findActiveByUserId(db: Queryable, userId: string): Promise<Session | null>;
  endSession(db: Queryable, sessionId: string): Promise<Session | null>;
  listByUserId(
    db: Queryable,
    userId: string,
    limit: number,
    cursor?: ListCursor,
  ): Promise<Session[]>;
}

export interface StageRepo {
  createForSession(db: Queryable, sessionId: string): Promise<Stage[]>;
  listBySessionId(db: Queryable, sessionId: string): Promise<Stage[]>;
  findActiveBySessionId(db: Queryable, sessionId: string): Promise<Stage | null>;
  completeStage(db: Queryable, stageId: string): Promise<Stage | null>;
  activateStage(
    db: Queryable,
    sessionId: string,
    position: number,
  ): Promise<Stage | null>;
}

/**
 * `withTransaction` is injected for the same reason the repositories are: a
 * unit test has no database, so it substitutes a version that simply calls the
 * callback with a stub connection. Without this the service would open a real
 * BEGIN on every test.
 */
export type WithTransaction = <T>(
  fn: (txConnection: Queryable) => Promise<T>,
) => Promise<T>;

export interface SessionServiceDeps {
  /** The pool in production; an unused stub in unit tests. */
  db: Queryable;
  withTransaction: WithTransaction;
  sessionRepository: SessionRepo;
  stageRepository: StageRepo;
}
