import type {
  LlmAdapter,
  LlmChunk,
  LlmStreamRequest,
  LlmUsage,
} from "./llm.types.ts";

/**
 * In-memory `LlmAdapter`. The first instance of the adapter pattern; the
 * Gemini one is the second.
 *
 * A **fake**, not a mock (§7): it holds real state and behaves like the thing
 * it stands in for, so tests assert on outcomes — what got persisted, what
 * reached the client — rather than on which methods were called. A test that
 * checks calls breaks on every refactor; one that checks results does not.
 *
 * It also makes the failure modes deterministic. A real provider cannot be
 * asked to die halfway through a stream on command, and that is precisely the
 * case the SSE route has to survive: headers are already sent, status 200 is
 * already committed, so there is no way left to return an error response.
 */
export interface FakeLlmAdapterOptions {
  /**
   * Text chunks to emit, in order. Split across several entries to exercise a
   * consumer that has to accumulate — a single chunk hides bugs where only the
   * first or last piece is kept.
   */
  chunks?: string[];

  /** Milliseconds between chunks. Left at 0 so tests stay fast. */
  delayMs?: number;

  /**
   * Throw after this many chunks have been yielded. The mid-stream failure
   * case: some text has already reached the client and cannot be unsent.
   */
  failAfterChunks?: number;

  /** Throw before yielding anything — provider rejected the request outright. */
  failImmediately?: Error;

  /** Reported on the terminal `done` chunk. */
  usage?: LlmUsage;
}

export class FakeLlmAdapter implements LlmAdapter {
  /**
   * Every request this adapter has been handed, in order. Lets a test assert
   * that the transcript was passed through intact and that the system
   * instruction was built for the right stage — without the adapter needing to
   * know what either of those means.
   */
  readonly requests: LlmStreamRequest[] = [];

  constructor(private readonly options: FakeLlmAdapterOptions = {}) {}

  /**
   * An async generator, which is the cheapest way to produce an
   * `AsyncIterable`. Note the generator body does not run until the first
   * `for await` — same lazy semantics the real adapters will have, so a test
   * against this fake exercises the same ordering.
   */
  async *streamReply(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    this.requests.push(request);

    const {
      chunks = [
        "Thanks for walking me through that. ",
        "What would you ",
        "change if the input doubled?",
      ],
      delayMs = 0,
      failAfterChunks,
      failImmediately,
      usage = { inputTokens: 100, outputTokens: 20 },
    } = this.options;

    if (failImmediately) throw failImmediately;

    let emitted = 0;

    for (const text of chunks) {
      // Checked before each chunk, not just at the start: the point of an
      // abort is to stop work already in flight.
      request.signal?.throwIfAborted();

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      yield { type: "text", text };
      emitted += 1;

      if (failAfterChunks !== undefined && emitted >= failAfterChunks) {
        throw new Error(
          `FakeLlmAdapter: simulated failure after ${String(emitted)} chunk(s)`,
        );
      }
    }

    yield { type: "done", usage };
  }
}
