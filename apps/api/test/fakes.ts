import { randomUUID } from "node:crypto";
import type { Queryable } from "../src/db/types.ts";
import type {
  SessionRepo,
  SessionServiceDeps,
  StageRepo,
} from "../src/modules/sessions/session.deps.ts";
import type { Session } from "../src/modules/sessions/session.schemas.ts";
import type { Stage } from "../src/modules/stages/stage.schemas.ts";
import { STAGE_KINDS } from "../src/modules/stages/stage.schemas.ts";

/**
 * In-memory fakes for service unit tests.
 *
 * These are **fakes**, not mocks: they hold real state and behave like the
 * thing they replace, rather than recording calls. A test sets up a world,
 * runs the service, and asserts on the outcome — not on which methods were
 * invoked. Asserting on calls couples a test to implementation; asserting on
 * outcomes does not (CLAUDE.md section 7).
 *
 * Deliberately no SQL and no database. The service's branching is what is
 * under test here; whether the queries are correct is the repository
 * integration tests' job.
 */

/** A connection the fakes ignore entirely — they never run a query. */
export const noConnection = {} as Queryable;

/**
 * Stand-in for `withTransaction` that simply runs the callback.
 *
 * Real rollback behaviour is a database property and cannot be faked
 * meaningfully, so it is not attempted. What this preserves is the part the
 * service cares about: a throw inside the callback propagates out.
 */
export const passthroughTransaction = <T>(
  fn: (conn: Queryable) => Promise<T>,
): Promise<T> => fn(noConnection);

// ── builders ───────────────────────────────────────────────────────────────

let clock = Date.UTC(2026, 0, 1);

/** Distinct, ordered timestamps so cursor and ordering assertions are stable. */
function nextDate(): Date {
  clock += 60_000;
  return new Date(clock);
}

export function buildSession(overrides: Partial<Session> = {}): Session {
  const createdAt = overrides.createdAt ?? nextDate();
  return {
    id: randomUUID(),
    userId: randomUUID(),
    track: "react",
    difficulty: "medium",
    status: "in_progress",
    endedAt: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...overrides,
  };
}

export function buildStage(overrides: Partial<Stage> = {}): Stage {
  const createdAt = overrides.createdAt ?? nextDate();
  return {
    id: randomUUID(),
    sessionId: randomUUID(),
    kind: "introduction",
    position: 1,
    status: "pending",
    startedAt: null,
    completedAt: null,
    workingState: {},
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/** The four stages a real session starts with: first active, rest pending. */
export function buildStageSet(sessionId: string): Stage[] {
  return STAGE_KINDS.map((kind, i) =>
    buildStage({
      sessionId,
      kind,
      position: i + 1,
      status: i === 0 ? "active" : "pending",
      startedAt: i === 0 ? nextDate() : null,
    }),
  );
}

// ── fake repositories ──────────────────────────────────────────────────────

export interface FakeSessionRepo extends SessionRepo {
  /** Direct access to the stored rows, for arranging and asserting. */
  rows: Session[];
}

export function createFakeSessionRepo(seed: Session[] = []): FakeSessionRepo {
  const rows = [...seed];

  return {
    rows,

    create(_db, input) {
      const session = buildSession({
        id: input.id,
        userId: input.userId,
        track: input.track,
        difficulty: input.difficulty,
      });
      rows.push(session);
      return Promise.resolve(session);
    },

    findById(_db, id) {
      return Promise.resolve(
        rows.find((r) => r.id === id && r.deletedAt === null) ?? null,
      );
    },

    findActiveByUserId(_db, userId) {
      return Promise.resolve(
        rows.find(
          (r) =>
            r.userId === userId &&
            r.status === "in_progress" &&
            r.deletedAt === null,
        ) ?? null,
      );
    },

    endSession(_db, sessionId) {
      const i = rows.findIndex(
        (r) => r.id === sessionId && r.status === "in_progress",
      );
      const current = rows[i];
      // Mirrors the SQL guard: no in-progress row means no update happened.
      if (!current) return Promise.resolve(null);

      const ended: Session = {
        ...current,
        status: "completed",
        endedAt: new Date(),
      };
      rows[i] = ended;
      return Promise.resolve(ended);
    },

    listByUserId(_db, userId, limit, cursor) {
      const mine = rows
        .filter((r) => r.userId === userId && r.deletedAt === null)
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        );

      const from = cursor
        ? mine.findIndex(
            (r) =>
              r.createdAt.getTime() === cursor.createdAt.getTime() &&
              r.id === cursor.id,
          ) + 1
        : 0;

      return Promise.resolve(mine.slice(from, from + limit));
    },
  };
}

export interface FakeStageRepo extends StageRepo {
  rows: Stage[];
  /** Set to make the next `activateStage` reject, simulating Postgres 23505. */
  failNextActivateWith?: unknown;
}

export function createFakeStageRepo(seed: Stage[] = []): FakeStageRepo {
  const rows = [...seed];

  const fake: FakeStageRepo = {
    rows,

    createForSession(_db, sessionId) {
      const created = buildStageSet(sessionId);
      rows.push(...created);
      return Promise.resolve(created);
    },

    listBySessionId(_db, sessionId) {
      return Promise.resolve(
        rows
          .filter((r) => r.sessionId === sessionId)
          .sort((a, b) => a.position - b.position),
      );
    },

    findActiveBySessionId(_db, sessionId) {
      return Promise.resolve(
        rows.find((r) => r.sessionId === sessionId && r.status === "active") ??
          null,
      );
    },

    completeStage(_db, stageId) {
      const i = rows.findIndex(
        (r) => r.id === stageId && r.status === "active",
      );
      const current = rows[i];
      if (!current) return Promise.resolve(null);

      const done: Stage = {
        ...current,
        status: "completed",
        completedAt: new Date(),
      };
      rows[i] = done;
      return Promise.resolve(done);
    },

    activateStage(_db, sessionId, position) {
      const failure = fake.failNextActivateWith;
      if (failure !== undefined) {
        fake.failNextActivateWith = undefined;
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- pg throws objects carrying a `code`, not Error instances
        return Promise.reject(failure);
      }

      const i = rows.findIndex(
        (r) =>
          r.sessionId === sessionId &&
          r.position === position &&
          r.status === "pending",
      );
      const current = rows[i];
      // No pending stage at that position — how the service learns the
      // interview has no further stages.
      if (!current) return Promise.resolve(null);

      const active: Stage = {
        ...current,
        status: "active",
        startedAt: new Date(),
      };
      rows[i] = active;
      return Promise.resolve(active);
    },
  };

  return fake;
}

// ── assembly ───────────────────────────────────────────────────────────────

export interface FakeDeps extends SessionServiceDeps {
  sessionRepository: FakeSessionRepo;
  stageRepository: FakeStageRepo;
}

/**
 * Builds a full dependency set for `createSessionService`.
 *
 *   const deps = createFakeDeps({ sessions: [session], stages: stageSet });
 *   const service = createSessionService(deps);
 *
 * Returning the fakes (not just the deps) lets a test inspect stored rows
 * afterwards, which is how outcome-based assertions stay possible.
 */
export function createFakeDeps(
  seed: { sessions?: Session[]; stages?: Stage[] } = {},
): FakeDeps {
  return {
    db: noConnection,
    withTransaction: passthroughTransaction,
    sessionRepository: createFakeSessionRepo(seed.sessions),
    stageRepository: createFakeStageRepo(seed.stages),
  };
}
