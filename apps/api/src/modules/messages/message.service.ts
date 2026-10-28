import { pool } from "../../db/pool.ts";
import { uuidv7 } from "../../db/uuid.ts";
import { ConflictError } from "../../errors/AppError.ts";
import { FakeLlmAdapter } from "../../lib/llm/fake.adapter.ts";
import type { LlmChunk } from "../../lib/llm/llm.types.ts";
import { sessionService } from "../sessions/session.service.ts";
import type { Session } from "../sessions/session.schemas.ts";
import type { Stage, StageKind } from "../stages/stage.schemas.ts";
import type { MessageServiceDeps } from "./message.deps.ts";
import * as messageRepository from "./message.repository.ts";
import type { Message } from "./message.schemas.ts";

/**
 * One interview turn: the candidate says something, the interviewer replies.
 *
 * The awkward part of this module is that a turn has to serve two consumers
 * with different needs. The client wants each chunk the moment it exists; the
 * database wants one complete string, which only exists after the last chunk.
 * §4 leaves this layer as the only one allowed to do both — a controller may
 * not touch the database, and a repository knows nothing of streams.
 *
 * So this service sits *inside* the stream rather than handing it off: it
 * forwards every chunk outward while accumulating the text, and writes the
 * interviewer message once the stream completes on its own terms.
 */

/**
 * Maximum candidate messages per stage, by stage kind.
 *
 * A code constant rather than a persisted column, decided deliberately: a
 * session straddling a deploy would keep whatever numbers are current rather
 * than the ones it started under, and that was judged an acceptable cost for a
 * practice tool. Revisit if these start changing often.
 *
 * Deliberately low while building — a full four-stage lifecycle test should be
 * cheap to run. Real values are introduction 6, coding 25, system_design 20,
 * behavioral 12.
 */
export const MAX_TURNS_BY_STAGE: Record<StageKind, number> = {
  introduction: 3,
  coding: 4,
  system_design: 3,
  behavioral: 3,
};

/**
 * Bounds one reply. Has to stay under the 16000-character
 * `chk_messages_content_length` cap for the interviewer role, or a reply gets
 * generated, streamed, and *then* rejected at insert time.
 */
export const MAX_OUTPUT_TOKENS = 2048;

/**
 * Placeholder. Prompt design is still an open question — this exists so the
 * shape is right and the plumbing is exercised, not because the wording is
 * good. Everything the interviewer persona needs is derivable from these three
 * values, which is why the adapter never sees them.
 */
function buildSystemInstruction(session: Session, stage: Stage): string {
  return [
    `You are conducting the ${stage.kind} stage of a technical interview.`,
    `Track: ${session.track}. Difficulty: ${session.difficulty}.`,
    `Ask one question at a time and respond to what the candidate actually said.`,
  ].join(" ");
}

export function createMessageService(deps: MessageServiceDeps) {
  const { db, messageRepository, sessions, llm } = deps;

  /**
   * Two phases, and the split is the important part of this signature.
   *
   * Everything that can fail *cleanly* happens eagerly, before the returned
   * iterable is touched: ownership, the stage guard, the turn cap, and the
   * candidate insert. Those throw typed errors, the middleware maps them, and
   * the client gets a 404 / 409 / 400 like any other request.
   *
   * Only then does the caller get an `AsyncIterable` to drain. By the time the
   * stream starts, the route has already committed `200` and the SSE headers —
   * so nothing beyond this point can be reported as an HTTP status. Keeping the
   * guards out of the generator is what makes that safe.
   *
   * This is why the function is `async` returning an iterable, rather than an
   * `async function*`. A generator body does not run until the first pull, so
   * guards inside one would fire *after* the headers were already sent.
   */
  async function sendMessage(
    sessionId: string,
    userId: string,
    content: string,
  ): Promise<AsyncIterable<LlmChunk>> {
    // Ownership first. Throws NotFoundError when the session does not exist
    // *or* is not this user's — the same error for both, so a caller cannot
    // probe for which.
    const { session, stages } = await sessions.getSession(sessionId, userId);

    // Checked before the stage lookup on purpose. A finished session has no
    // active stage either, so the reverse order would report the corrupt-state
    // conflict for the perfectly ordinary case of a completed interview.
    if (session.status !== "in_progress") {
      throw new ConflictError(
        "This interview has already ended and cannot take new messages.",
      );
    }

    const stage = stages.find((s) => s.status === "active");
    if (!stage) {
      // Should be unreachable: an in-progress session always has exactly one
      // active stage, per uq_stages_one_active_per_session. Worth a loud 409
      // rather than a repair — we would be guessing at how it broke.
      throw new ConflictError(
        "This interview has no stage in progress. Please reload and try again.",
      );
    }

    // Read once, use twice: the turn cap counts from this, and the LLM gets it
    // as the conversation history. A separate count query would be a second
    // round trip for a number this array already has.
    const transcript = await messageRepository.listByStageId(db, stage.id);

    // Candidate messages only. Interviewer replies are not the candidate's
    // turns, and counting both would halve every cap.
    const turnsTaken = transcript.filter((m) => m.role === "candidate").length;
    if (turnsTaken >= MAX_TURNS_BY_STAGE[stage.kind]) {
      throw new ConflictError(
        `This stage has reached its limit of ${String(
          MAX_TURNS_BY_STAGE[stage.kind],
        )} messages. Advance to continue the interview.`,
      );
    }

    // Before the LLM call, never after: this is what lets
    // chk_messages_content_length reject an oversized message while it is
    // still free to do so.
    const candidateMessage = await messageRepository.create(db, {
      id: uuidv7(),
      stageId: stage.id,
      role: "candidate",
      content,
    });

    // The message just saved has to be in what the model sees, otherwise it
    // would be answering the previous turn.
    return streamReply(session, stage, [...transcript, candidateMessage]);
  }

  // TODO(raymond) — phase 2: the pass-through.
  //
  //   Forward every chunk to the caller, accumulate the text as it goes, and
  //   write the interviewer message with `messageRepository.create`.
  //
  //   `buildSystemInstruction(session, stage)` and MAX_OUTPUT_TOKENS are the
  //   other two things `llm.streamReply` needs.
  //
  //   Two things to decide:
  //
  //   - §10 allows logging the token counts off the `done` chunk, and forbids
  //     logging the text. Nothing else about `done` is needed for the
  //     forwarding itself.
  //
  //   - A truncated reply must not be saved — it would be resent to Gemini
  //     next turn as though it were a complete question.
  //
  //   Which brings up the one genuinely subtle thing here. This loop can end
  //   three different ways:
  //
  //       the provider finishes normally
  //       the provider throws partway
  //       the caller stops pulling (candidate closed the tab)
  //
  //   Work out which of those reach the code *after* the loop and which do
  //   not — and in particular, whether a `finally` block would help or hurt.
  //   Getting the insert in the right place means you need no flag at all.
  //
  //   Shape:
  //     async function* streamReply(
  //       session: Session,
  //       stage: Stage,
  //       transcript: Message[],
  //     ): AsyncIterable<LlmChunk> { ... }
  // eslint-disable-next-line require-yield, @typescript-eslint/require-await -- stub
  async function* streamReply(
    session: Session,
    stage: Stage,
    transcript: Message[],
  ): AsyncIterable<LlmChunk> {
    void [session, stage, transcript, llm, buildSystemInstruction];
  }

  return { sendMessage };
}

export type MessageService = ReturnType<typeof createMessageService>;

// ───────────────────────────────────────────────────────────────────────────
// The production instance.
//
// `FakeLlmAdapter` for now, deliberately: the whole turn flow is runnable and
// testable end to end with no API key, and swapping in GeminiAdapter is one
// line here. That swap is the second instance of the adapter pattern, and it is
// Raymond's.
// ───────────────────────────────────────────────────────────────────────────

export const messageService = createMessageService({
  db: pool,
  messageRepository,
  sessions: sessionService,
  llm: new FakeLlmAdapter(),
});
