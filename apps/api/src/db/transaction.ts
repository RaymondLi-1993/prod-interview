import { pool } from "./pool.js";
import type { Queryable } from "./types.js";

/**
 * Runs `fn` inside a single transaction.
 *
 * Commits if `fn` resolves, rolls back if it throws, and always returns the
 * connection to the pool. A leaked connection is permanent — ten leaks and the
 * pool is dead — so the release lives in `finally`.
 *
 *   await withTransaction(async (tx) => {
 *     const session = await sessionRepository.create(tx, { ... });
 *     await stageRepository.createAll(tx, session.id);
 *     return session;
 *   });
 *
 * Both writes land, or neither does.
 */
export async function withTransaction<T>(
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // The rollback is best-effort: if the connection itself died, this throws
    // too, and that error would mask the real one. Swallow it deliberately.
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
