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
    const service = await createSessionService(createFakeDeps());

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
  // TODO(raymond) #5 — the happy path, middle of the interview.
  //   Arrange: arrangeActiveSession() — introduction is active.
  //   Act:     advanceSession
  //   Assert:  introduction is completed with a completedAt; coding is active
  //            with a startedAt; the session is still in_progress.
  it("completes the active stage and activates the next", async () => {
    const { session, service } = arrangeActiveSession();

    const nextStage = await service.advanceSession(session.id, USER);

    expect(nextStage.stages[0]?.status).toBe("completed");
    expect(nextStage.stages[0]?.completedAt).not.toBeNull();
    expect(nextStage.session.status).toBe("in_progress");
    expect(nextStage.stages[1]?.status).toBe("active");
    expect(nextStage.stages[1]?.startedAt).not.toBeNull();
  });

  // TODO(raymond) #6 — the final stage ends the interview.
  //   Arrange: a session whose stages are all completed EXCEPT the last, which
  //            is active. Build it by mapping over buildStageSet's result, or
  //            call advanceSession three times first — either is fine.
  //   Assert:  session.status is "completed", endedAt is a Date, and every
  //            stage is completed.
  it.todo("ends the session after the final stage completes");

  // TODO(raymond) #7 — guard: already finished.
  //   Arrange: buildSession({ userId: USER, status: "completed" }).
  //   Assert:  ConflictError.
  it.todo("rejects advancing a session that has already ended");

  // TODO(raymond) #8 — guard: nothing active.
  //   Arrange: a session in_progress, but pass stages where none has
  //            status "active" (map buildStageSet to all "pending").
  //   Assert:  ConflictError. This is a corrupt state that should not occur,
  //            which is exactly why it is worth pinning.
  it.todo("rejects advancing when no stage is active");

  // TODO(raymond) #9 — ownership.
  //   Act as OTHER_USER against USER's session.
  //   Assert:  NotFoundError — and nothing changed. Check the stages are
  //            untouched afterwards, not just that it threw.
  it.todo("another user cannot advance the session");

  // TODO(raymond) #10 — the concurrency branch.
  //   Arrange: arrangeActiveSession(), then
  //            deps.stageRepository.failNextActivateWith = { code: "23505" };
  //   Assert:  ConflictError.
  //   This is the second advance losing the race on
  //   uq_stages_one_active_per_session. The fake makes it deterministic.
  it.todo("translates a 23505 from activateStage into ConflictError");
});

// ───────────────────────────────────────────────────────────────────────────
describe("listSessions", () => {
  // TODO(raymond) #11 — ordering and ownership.
  //   Arrange: three sessions for USER and two for OTHER_USER. buildSession
  //            gives each a later createdAt than the last, so they are
  //            naturally ordered.
  //   Assert:  USER gets exactly their three, newest first.
  it.todo("returns only the user's own sessions, newest first");

  // TODO(raymond) #12 — the limit.
  //   Arrange: five sessions for USER. Act with limit 2.
  //   Assert:  two rows come back.
  it.todo("respects the limit");
});
