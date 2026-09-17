import { pool } from "./pool.ts";
import type { Queryable } from "./types.ts";

/**
 * Runs `fn` inside a single transaction.
 *
 * Checks out **one** connection from the pool, runs BEGIN on it, and passes it
 * to `fn`. Every query inside must use that connection — `BEGIN`, the
 * statements, and `COMMIT` are only a transaction if they happen on the same
 * one. Reaching for `pool` inside `fn` silently escapes the transaction: that
 * query lands on a different connection, commits immediately, and will not
 * roll back with the rest.
 *
 * Commits if `fn` resolves, rolls back if it throws, and always returns the
 * connection to the pool. A leaked connection is permanent — ten leaks and the
 * pool is dead — so the release lives in `finally`.
 *
 *   await withTransaction(async (txConnection) => {
 *     const session = await sessionRepository.create(txConnection, { ... });
 *     await stageRepository.createForSession(txConnection, session.id);
 *     return session;
 *   });
 *
 * Both writes land, or neither does.
 */
export async function withTransaction<T>(
  fn: (txConnection: Queryable) => Promise<T>,
): Promise<T> {
  const txConnection = await pool.connect();

  try {
    await txConnection.query("BEGIN");
    const result = await fn(txConnection);
    await txConnection.query("COMMIT");
    return result;
  } catch (error) {
    // The rollback is best-effort: if the connection itself died, this throws
    // too, and that error would mask the real one. Swallow it deliberately.
    await txConnection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    // Back to the pool on every path — success, throw, or a failed rollback.
    txConnection.release();
  }
}
