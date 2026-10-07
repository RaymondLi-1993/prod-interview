import type { Queryable } from "../../db/types.ts";
import type { LlmAdapter } from "../../lib/llm/llm.types.ts";
import type { SessionWithStages } from "../sessions/session.service.ts";
import type { CreateMessageInput } from "./message.repository.ts";
import type { Message } from "./message.schemas.ts";

/**
 * What the message service depends on. Same seam as `session.deps.ts`: the
 * service is written against these shapes, so production passes the real
 * repositories and a unit test passes fakes.
 */

export interface MessageRepo {
  create(db: Queryable, input: CreateMessageInput): Promise<Message>;
  listByStageId(db: Queryable, stageId: string): Promise<Message[]>;
}

/**
 * Only the one method this service needs from the sessions module, not the
 * whole `SessionService`.
 *
 * Note this is **service → service**, which §4 requires — the message service
 * must not reach into `session.repository` itself. The payoff is concrete:
 * `getSession` already throws `NotFoundError` for a session that does not exist
 * *or is not yours*, so ownership is enforced in one place rather than
 * reimplemented here. It also returns the stages, which is how this service
 * finds the active one without needing a stage repository at all.
 */
export interface SessionReader {
  getSession(sessionId: string, userId: string): Promise<SessionWithStages>;
}

export interface MessageServiceDeps {
  /** The pool in production; an unused stub in unit tests. */
  db: Queryable;
  messageRepository: MessageRepo;
  sessions: SessionReader;
  llm: LlmAdapter;
}
