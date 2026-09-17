import type { PoolClient } from "pg";
import { pool } from "../src/db/pool.ts";
import type { Queryable } from "../src/db/types.ts";

/**
 * Runs a test body inside a transaction that is **always** rolled back.
 *
 * Integration tests need a real database — a mocked driver proves the SQL
 * string is unchanged, not that it is correct (see README: Testing). But real
 * writes would leave rows behind, so every test gets a transaction that is
 * discarded whether it passes or fails.
 *
 * The rollback is the assertion-independent part: it happens in `finally`, so
 * a thrown assertion still cleans up.
 *
 *   it("finds a user", () =>
 *     withRollback(async (db) => {
 *       const user = await createUser(db, { ... });
 *       expect(await findUserById(db, user.id)).not.toBeNull();
 *     }));
 */
export async function withRollback(
  fn: (db: Queryable) => Promise<void>,
): Promise<void> {
  const client: PoolClient = await pool.connect();

  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** Closes the pool so the test process can exit. */
export async function closeTestPool(): Promise<void> {
  await pool.end();
}
