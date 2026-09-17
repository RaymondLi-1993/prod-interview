import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, withRollback } from "../../../test/db.js";
import type { Queryable } from "../../db/types.js";
import * as sessionRepository from "./session.repository.js";

/**
 * Integration tests: real SQL against a real database (see README: Testing).
 *
 * Each test runs in a transaction that is rolled back, so tests can create
 * whatever they need and leave nothing behind.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF EVERY TEST HERE — arrange, act, assert:
 *
 *   it("describes the behaviour, not the implementation", () =>
 *     withRollback(async (db) => {
 *       // ARRANGE — build the world this test needs
 *       const userId = await insertUser(db);
 *
 *       // ACT — call exactly one thing
 *       const result = await sessionRepository.someMethod(db, userId);
 *
 *       // ASSERT — state what must be true
 *       expect(result).toBeNull();
 *     }));
 *
 * Note `it(...)` returns the promise from `withRollback` rather than using an
 * `async` callback — vitest waits on it either way, and this keeps the
 * rollback attached to the test's lifetime.
 * ---------------------------------------------------------------------------
 *
 * The bar for a test here is not "does it pass" but "would it fail if the
 * query were wrong". Break the SQL on purpose and re-run — a test that still
 * passes is testing nothing. That check is called mutation testing, and it is
 * worth doing by hand on anything important.
 */

afterAll(closeTestPool);

/** Sessions need an owner; every test starts by making one. */
async function insertUser(db: Queryable): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO users (id, auth_provider, auth_provider_id, email)
     VALUES ($1, 'supabase', $2, $3)`,
    [id, `sub-${id}`, `${id}@test.local`],
  );
  return id;
}

describe("sessionRepository.create", () => {
  it("returns a camelCase domain object", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);

      const session = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "react",
        difficulty: "medium",
      });

      expect(session.userId).toBe(userId);
      expect(session.track).toBe("react");
      expect(session.status).toBe("in_progress");
      expect(session.endedAt).toBeNull();
      expect(session.createdAt).toBeInstanceOf(Date);

      // No snake_case escapes the repository.
      expect(session).not.toHaveProperty("user_id");
    }));

  it("rejects a second in-progress session for the same user", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);
      const base = { userId, track: "react", difficulty: "medium" } as const;

      await sessionRepository.create(db, { id: randomUUID(), ...base });

      // uq_sessions_one_active_per_user — Postgres 23505.
      await expect(
        sessionRepository.create(db, { id: randomUUID(), ...base }),
      ).rejects.toMatchObject({ code: "23505" });
    }));

  it("allows a new session once the previous one has ended", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);
      const first = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "react",
        difficulty: "medium",
      });

      await db.query(
        `UPDATE sessions SET status = 'completed', ended_at = now() WHERE id = $1`,
        [first.id],
      );

      const second = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "backend",
        difficulty: "hard",
      });

      expect(second.id).not.toBe(first.id);
    }));
});

describe("sessionRepository.findById", () => {
  it("returns null when the id is unknown", () =>
    withRollback(async (db) => {
      // Arrange: nothing — an id that was never inserted.
      // Act + assert together, since there is only one call.
      expect(await sessionRepository.findById(db, randomUUID())).toBeNull();
    }));

  it("hides soft-deleted sessions", () =>
    withRollback(async (db) => {
      // Arrange
      const userId = await insertUser(db);
      const session = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "react",
        difficulty: "easy",
      });
      await db.query(`UPDATE sessions SET deleted_at = now() WHERE id = $1`, [
        session.id,
      ]);

      // Act
      const found = await sessionRepository.findById(db, session.id);

      // Assert — the row still exists; the query must not return it.
      expect(found).toBeNull();
    }));
});

describe("sessionRepository.findActiveByUserId", () => {
  it("finds the in-progress session and ignores finished ones", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);

      const done = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "frontend",
        difficulty: "easy",
      });
      await db.query(
        `UPDATE sessions SET status = 'completed', ended_at = now() WHERE id = $1`,
        [done.id],
      );

      const active = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "backend",
        difficulty: "hard",
      });

      const found = await sessionRepository.findActiveByUserId(db, userId);
      expect(found?.id).toBe(active.id);
    }));

  // ---- START HERE -----------------------------------------------------
  // TODO(raymond) #1 — the simplest test in the file.
  //   Arrange: a user, and nothing else.
  //   Act:     findActiveByUserId
  //   Assert:  null
  //   Closest example: "returns null when the id is unknown", above.
  it("returns null when the user has no session", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);

      const found = await sessionRepository.findActiveByUserId(db, userId);
      expect(found).toBeNull();
    }));

  // TODO(raymond) #2 — soft delete.
  //   Arrange: a user with ONE in-progress session, then set its deleted_at.
  //   Assert:  null — the session is active but deleted.
  //   Closest example: "hides soft-deleted sessions", above. Nearly identical.
  //   Ask yourself: which half of the WHERE clause does this one pin down?
  it("ignores a soft-deleted in-progress session", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);

      const active = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "backend",
        difficulty: "hard",
      });
      await db.query(
        `UPDATE sessions SET status = 'in_progress', deleted_at = now() WHERE id = $1`,
        [active.id],
      );

      const found = await sessionRepository.findActiveByUserId(db, userId);
      expect(found).toBeNull();
    }));

  // TODO(raymond) #3 — the one that matters most.
  //   The passing test above does NOT catch a missing status filter: remove
  //   `status = 'in_progress'` from the query and it still passes, because
  //   both rows come back and rows[0] happens to be the active one.
  //
  //   Arrange: a user whose sessions have ALL ended (create two, complete
  //            both — the loop in "allows a new session once the previous
  //            one has ended" shows how to complete one).
  //   Assert:  null.
  //
  //   Then prove it works: delete `AND status = 'in_progress'` from
  //   findActiveByUserId and re-run. This test must fail. Put it back.
  it("returns null when every session has ended", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);

      const active = await sessionRepository.create(db, {
        id: randomUUID(),
        userId,
        track: "backend",
        difficulty: "hard",
      });

      expect(
        await sessionRepository.findActiveByUserId(db, userId),
      ).not.toBeNull();

      await db.query(
        `UPDATE sessions SET status = 'completed', ended_at = now() WHERE id = $1`,
        [active.id],
      );

      const found = await sessionRepository.findActiveByUserId(db, userId);
      expect(found).toBeNull();
    }));
});

describe("sessionRepository.listByUserId", () => {
  /** Creates n sessions with distinct created_at values, oldest first. */
  async function insertSessions(db: Queryable, userId: string, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      ids.push(id);
      await db.query(
        `INSERT INTO sessions (id, user_id, track, difficulty, status, ended_at, created_at)
         VALUES ($1, $2, 'react', 'medium', 'completed', now(), now() - make_interval(mins => $3::int))`,
        [id, userId, n - i],
      );
    }
    return ids; // oldest → newest
  }

  it("returns newest first", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);
      const ids = await insertSessions(db, userId, 3);

      const page = await sessionRepository.listByUserId(db, userId, 10);

      expect(page.map((s) => s.id)).toEqual([...ids].reverse());
    }));

  // TODO(raymond) #4 — ownership.
  //   Arrange: TWO users, each with sessions (call insertUser twice).
  //   Act:     list one user's sessions.
  //   Assert:  only their rows come back — check both the count and that
  //            every row's userId matches.
  //   This is the test that catches a missing `user_id = $1`, which would
  //   otherwise leak one user's history to another.
  it("excludes other users' sessions", () =>
    withRollback(async (db) => {
      const userId = await insertUser(db);
      const userId2 = await insertUser(db);

      await insertSessions(db, userId, 2);
      await insertSessions(db, userId2, 3);

      const page = await sessionRepository.listByUserId(db, userId, 10);
      expect(page).toHaveLength(2);
      expect(page.every((s) => s.userId === userId)).toBe(true);
    }));

  // TODO(raymond) #5 — keyset pagination. Hardest, and the most valuable.
  //   Arrange: 5 sessions for one user.
  //   Act:     fetch a page of 2. Then take the LAST row of that page and
  //            pass { createdAt, id } as the cursor to fetch 2 more.
  //   Assert:  page two continues exactly where page one stopped — nothing
  //            repeated, nothing skipped.
  //
  //   Hints:
  //     - insertSessions returns ids oldest → newest
  //     - the query returns newest first, so [...ids].reverse() is the
  //       expected full order
  //     - page one should equal the first 2 of that; page two the next 2
  //     - noUncheckedIndexedAccess is on, so `page[page.length - 1]` is
  //       possibly-undefined — narrow it before using it
  it.todo("paginates by cursor without repeating or skipping rows");
});
