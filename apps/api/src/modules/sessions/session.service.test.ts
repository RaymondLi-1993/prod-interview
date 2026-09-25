import { describe, expect, it } from "vitest";
// The TODOs below will need these — add them as you go, or let your editor
// auto-import:
//   import { randomUUID } from "node:crypto";
//   import { ConflictError, NotFoundError } from "../../errors/AppError.ts";
import {
  buildSession,
  buildStageSet,
  createFakeDeps,
} from "../../../test/fakes.ts";
import { createSessionService } from "./session.service.ts";
import { randomUUID } from "node:crypto";
import { ConflictError, NotFoundError } from "../../errors/AppError.ts";

/**
 * Service unit tests — no database.
 *
 * The subject here is the **branching**: which guard rejects what, and which
 * writes follow. Whether the SQL is correct is the repository integration
 * tests' job. Faking the repositories does not weaken these tests, because the
 * service never cared where the data came from — only what shape it was.
 *
 * This is the concrete payoff for the layering. Each test is a few lines of
 * setup and runs in about a millisecond; against a real database, reaching
 * "session already completed" would mean inserting a user, a session, four
 * stages, and advancing four times.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE:
 *
 *   it("describes the behaviour", async () => {
 *     // ARRANGE — build the world
 *     const session = buildSession({ userId: USER, status: "completed" });
 *     const service = createSessionService(createFakeDeps({ sessions: [session] }));
 *
 *     // ACT + ASSERT
 *     await expect(service.advanceSession(session.id, USER))
 *       .rejects.toBeInstanceOf(ConflictError);
 *   });
 *
 * Assert on outcomes, never on which repository methods were called. A test
 * that checks calls breaks when the implementation is refactored; one that
 * checks results does not.
 * ---------------------------------------------------------------------------
 */

const USER = "018f2c00-0000-7000-8000-00000000aaaa";

/** A second user, for the ownership tests. */
export const OTHER_USER = "018f2c00-0000-7000-8000-00000000bbbb";

/** A session owned by USER, with its four stages, introduction active. */
function arrangeActiveSession() {
  const session = buildSession({ userId: USER });
  const stages = buildStageSet(session.id);
  const deps = createFakeDeps({ sessions: [session], stages });

  return { session, stages, deps, service: createSessionService(deps) };
}

// ───────────────────────────────────────────────────────────────────────────
describe("createSession", () => {
  it("creates a session with four stages, introduction active", async () => {
    const deps = createFakeDeps();
    const service = createSessionService(deps);

    const { session, stages } = await service.createSession({
      userId: USER,
      track: "react",
      difficulty: "medium",
    });

    expect(session.userId).toBe(USER);
    expect(session.status).toBe("in_progress");
    expect(stages).toHaveLength(4);
    expect(stages[0]?.status).toBe("active");
    expect(stages.slice(1).every((s) => s.status === "pending")).toBe(true);
  });

  it("rejects a second in-progress session for the same user", async () => {
    const session = buildSession({ userId: USER, status: "in_progress" });
    const service = createSessionService(
      createFakeDeps({ sessions: [session] }),
    );

    await expect(service.createSession(session)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("translates a 23505 from create into ConflictError", async () => {
    const deps = createFakeDeps();

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- pg throws objects carrying a `code`, not Error instances
    deps.sessionRepository.create = () => Promise.reject({ code: "23505" });

    const service = createSessionService(deps);

    await expect(
      service.createSession({
        userId: USER,
        track: "react",
        difficulty: "medium",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("getSession", () => {
  it("returns the session with its stages", async () => {
    const { session, service } = arrangeActiveSession();

    const result = await service.getSession(session.id, USER);

    expect(result.session.id).toBe(session.id);
    expect(result.stages).toHaveLength(4);
    expect(result.stages.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it("throws NotFoundError when the session does not exist", async () => {
    const service = createSessionService(createFakeDeps());

    await expect(service.getSession(randomUUID(), USER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws NotFoundError when the session belongs to another user", async () => {
    const { session, service } = arrangeActiveSession();

    await expect(
      service.getSession(session.id, OTHER_USER),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("advanceSession", () => {
  it("completes the active stage and activates the next", async () => {
    const { session, service } = arrangeActiveSession();

    const nextStage = await service.advanceSession(session.id, USER);

    expect(nextStage.stages[0]?.status).toBe("completed");
    expect(nextStage.stages[0]?.completedAt).not.toBeNull();
    expect(nextStage.session.status).toBe("in_progress");
    expect(nextStage.stages[1]?.status).toBe("active");
    expect(nextStage.stages[1]?.startedAt).not.toBeNull();
  });

  it("ends the session after the final stage completes", async () => {
    const { session, service } = arrangeActiveSession();

    // Walk the whole interview. Only the fourth advance matters: it completes
    // the behavioral stage, finds no stage at position 5, and ends the session.
    await service.advanceSession(session.id, USER);
    await service.advanceSession(session.id, USER);
    await service.advanceSession(session.id, USER);
    const result = await service.advanceSession(session.id, USER);

    expect(result.session.status).toBe("completed");
    expect(result.session.endedAt).toBeInstanceOf(Date);
    expect(result.stages).toHaveLength(4);
    expect(result.stages.every((s) => s.status === "completed")).toBe(true);
  });

  it("rejects advancing a session that has already ended", async () => {
    const session = buildSession({ userId: USER, status: "completed" });
    const service = createSessionService(
      createFakeDeps({
        sessions: [session],
        stages: buildStageSet(session.id),
      }),
    );

    await expect(
      service.advanceSession(session.id, USER),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects advancing when no stage is active", async () => {
    // A corrupt state that should never occur — every stage pending, none
    // active. Worth pinning precisely because it should be impossible: if the
    // guard were missing, this would throw a confusing TypeError instead of a
    // 409.
    const session = buildSession({ userId: USER });
    const stages = buildStageSet(session.id).map((s) => ({
      ...s,
      status: "pending" as const,
    }));

    const service = createSessionService(
      createFakeDeps({ sessions: [session], stages }),
    );

    await expect(
      service.advanceSession(session.id, USER),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("another user cannot advance the session", async () => {
    const { session, deps, service } = arrangeActiveSession();

    await expect(
      service.advanceSession(session.id, OTHER_USER),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Throwing is not enough — nothing must have changed. Without this, a
    // version that wrote first and checked ownership afterwards would pass.
    const stages = await deps.stageRepository.listBySessionId(
      deps.db,
      session.id,
    );
    expect(stages[0]?.status).toBe("active");
    expect(stages[0]?.completedAt).toBeNull();
    expect(stages[1]?.status).toBe("pending");
  });

  it("translates a 23505 from activateStage into ConflictError", async () => {
    const { session, deps, service } = arrangeActiveSession();

    // Two concurrent advances: both pass the guards, then the second one's
    // activateStage loses the race on uq_stages_one_active_per_session. The
    // fake makes that deterministic — a real database could not.
    deps.stageRepository.failNextActivateWith = { code: "23505" };

    await expect(
      service.advanceSession(session.id, USER),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("listSessions", () => {
  it("returns only the user's own sessions, newest first", async () => {
    // buildSession advances its clock, so each is created later than the last.
    const mine = [
      buildSession({ userId: USER }),
      buildSession({ userId: USER }),
      buildSession({ userId: USER }),
    ];
    const theirs = [
      buildSession({ userId: OTHER_USER }),
      buildSession({ userId: OTHER_USER }),
    ];

    const service = createSessionService(
      createFakeDeps({ sessions: [...mine, ...theirs] }),
    );

    const result = await service.listSessions(USER, 10);

    // Different counts on each side, so a missing owner filter would show up
    // as 5 rather than 3.
    expect(result).toHaveLength(3);
    expect(result.every((s) => s.userId === USER)).toBe(true);
    expect(result.map((s) => s.id)).toEqual(
      [...mine].reverse().map((s) => s.id),
    );
  });

  it("respects the limit", async () => {
    const sessions = Array.from({ length: 5 }, () =>
      buildSession({ userId: USER }),
    );
    const service = createSessionService(createFakeDeps({ sessions }));

    const result = await service.listSessions(USER, 2);

    expect(result).toHaveLength(2);
    // The two newest, since the query orders newest first.
    expect(result.map((s) => s.id)).toEqual(
      [...sessions]
        .reverse()
        .slice(0, 2)
        .map((s) => s.id),
    );
  });
});
