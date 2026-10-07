/**
 * The LLM seam.
 *
 * Everything provider-specific lives behind this interface: which SDK, which
 * model, how roles are named, how streaming is framed. The service layer knows
 * only `LlmAdapter`, so swapping Gemini for something else is one new file and
 * one wiring change — and it is also what makes the turn handler testable
 * without a network call, an API key, or a rate limit.
 *
 * Same dependency-injection payoff as `createSessionService`: the tests that
 * matter run against a fake in milliseconds. §7 calls this the contract-test
 * pattern — a fake implementation for the branching, plus one live smoke test
 * to prove the real provider still behaves.
 */

/**
 * One prior turn, in *our* vocabulary rather than the provider's.
 *
 * Providers disagree here — Gemini calls the assistant side `model`, most
 * others call it `assistant` — and that disagreement is exactly the kind of
 * detail an adapter exists to absorb. Each adapter maps these two roles onto
 * whatever its SDK wants.
 *
 * Declared here rather than imported from `modules/messages` so that `lib/`
 * stays free of feature-module imports. TypeScript is structurally typed, so a
 * `Message[]` is assignable to `readonly LlmMessage[]` anyway: the service
 * passes the transcript straight through with no mapping code.
 */
export interface LlmMessage {
  role: "interviewer" | "candidate";
  content: string;
}

/** Token counts for one call. Reported at the end of a stream. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * One event in a reply stream.
 *
 * A discriminated union rather than a bare `AsyncIterable<string>`, because
 * §10 forbids logging prompt or response bodies and requires logging token
 * counts instead — and a stream of plain strings has nowhere to put them.
 * Usage is only known once the provider finishes, hence the terminal `done`.
 *
 * This is also how the real SDKs frame streaming, so the shape transfers.
 */
export type LlmChunk =
  { type: "text"; text: string } | { type: "done"; usage: LlmUsage };

export interface LlmStreamRequest {
  /**
   * The stage-shaped interviewer instruction. Built by the service, because
   * prompt construction is business logic (§4) — it depends on stage kind,
   * track, and difficulty, none of which an adapter should know about.
   */
  systemInstruction: string;

  /**
   * The transcript so far, oldest first — exactly what `listByStageId`
   * returns. Empty on the first turn of a stage.
   *
   * Note this is resent in full on every turn, because the provider holds no
   * state between calls. Cost over a stage of N turns is therefore O(N²), not
   * O(N); see §0 on prompt caching.
   */
  transcript: readonly LlmMessage[];

  /**
   * Required, not defaulted — the caller must decide, because this number is
   * load-bearing twice over: it bounds spend per turn, and it has to stay
   * under the 16000-character `chk_messages_content_length` cap for the
   * interviewer role (roughly 4096 tokens).
   */
  maxOutputTokens: number;

  /**
   * Stop generating when the client goes away. SSE clients disconnect
   * constantly — closed tab, lost network, navigation — and without this the
   * provider keeps producing tokens nobody will ever read, and bills for them.
   */
  signal?: AbortSignal;
}

export interface LlmAdapter {
  /**
   * Deliberately not `async`: calling this returns the iterable immediately
   * and does no work. Nothing is sent to the provider until the first `for
   * await` pulls from it, so setup failures surface at the first iteration
   * rather than at the call site — which is where the consumer is already
   * handling errors anyway.
   */
  streamReply(request: LlmStreamRequest): AsyncIterable<LlmChunk>;
}
