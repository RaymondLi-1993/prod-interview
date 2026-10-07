import { pool } from "../../db/pool.ts";
import { uuidv7 } from "../../db/uuid.ts";
import { FakeLlmAdapter } from "../../lib/llm/fake.adapter.ts";
import type { LlmChunk } from "../../lib/llm/llm.types.ts";
import { sessionService } from "../sessions/session.service.ts";
import type { StageKind } from "../stages/stage.schemas.ts";
import type { MessageServiceDeps } from "./message.deps.ts";
import * as messageRepository from "./message.repository.ts";

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

export function createMessageService(deps: MessageServiceDeps) {
  const { db, messageRepository, sessions, llm } = deps;

  // Scaffolding: keeps `typecheck` and `lint` green while the two phases below
  // are unwritten. Delete this line once they use these.
  void [db, messageRepository, sessions, llm, uuidv7];

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
  // eslint-disable-next-line @typescript-eslint/require-await -- stub; phase 1 awaits
  async function sendMessage(
    sessionId: string,
    userId: string,
    content: string,
  ): Promise<AsyncIterable<LlmChunk>> {
    void [sessionId, userId, content]; // scaffolding — delete when written

    // TODO(raymond) — phase 1: validate and persist the candidate message.
    //
    //   1. Ownership + load. `sessions.getSession(sessionId, userId)` already
    //      throws NotFoundError for a session that does not exist or is not
    //      this user's, and it hands back the stages.
    //
    //   2. Which stage? Exactly one is `active` — that invariant is held by
    //      uq_stages_one_active_per_session. What should happen if there is
    //      none? (Compare `advanceSession`: it treats that as a corrupt state,
    //      not a 404.)
    //
    //   3. Is the session still open? Messaging a finished interview is not a
    //      404 — the session is real and it is yours.
    //
    //   4. The turn cap. MAX_TURNS_BY_STAGE is keyed by stage kind. Note you
    //      need the count of *candidate* messages, not all messages, and the
    //      transcript you are about to read gives you that without a second
    //      query.
    //
    //   5. Insert the candidate message. Before the LLM call, not after —
    //      that ordering is what lets chk_messages_content_length reject an
    //      oversized message before any tokens are spent.
    //
    //   Then return the generator below. Note what phase 1 has to hand it: the
    //   transcript to send, and the stage id to write the reply against.
    throw new Error("not implemented");
  }

  /**
   * Phase 2 — the pass-through. Forwards chunks to the caller, accumulates the
   * text, and persists the interviewer message when the provider finishes.
   */
  // TODO(raymond) — phase 2: stream and persist.
  //
  //   Shape:
  //     async function* streamReply(stageId, transcript): AsyncIterable<LlmChunk> {
  //       for await (const chunk of llm.streamReply({ ... })) {
  //         // forward it onward, and keep the text
  //       }
  //     }
  //
  //   Three things to get right:
  //
  //   - Build `systemInstruction` from the stage kind, the track, and the
  //     difficulty. Prompt design is still open — a placeholder string is fine
  //     for now, so long as the shape is right.
  //
  //   - Only save on a clean finish. The `done` chunk is the signal: reaching
  //     it means the provider ended on its own terms. No `done` means the
  //     stream threw, and a truncated interviewer message must not be written —
  //     it would be resent to Gemini next turn as if it were complete.
  //
  //   - §10: log the token counts off `done`, never the text.
  //
  //   The subtle one, worth thinking about before you write it: what happens to
  //   the code after the `for await` if the caller stops pulling early — the
  //   candidate closes the tab mid-reply? Which parts of a generator body are
  //   guaranteed to run, and which are not?

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
