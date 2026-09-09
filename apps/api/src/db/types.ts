import type { PoolClient } from "pg";

/**
 * Anything that can run a query.
 *
 * Satisfied by the pool itself and by a single client bound to an open
 * transaction, so a repository method written against this type works either
 * way without knowing which it received:
 *
 *   await userRepository.findById(pool, id);                        // standalone
 *   await withTransaction((tx) => userRepository.findById(tx, id)); // in a tx
 *
 * Deliberately narrowed to `query` alone — a repository has no business
 * calling `release()` or issuing its own `COMMIT`. Deciding when a transaction
 * is needed belongs to the service layer.
 */
export type Queryable = Pick<PoolClient, "query">;
