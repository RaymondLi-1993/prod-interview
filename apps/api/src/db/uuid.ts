/**
 * Primary keys are UUIDv7, per the locked decision in CLAUDE.md §3.
 *
 * Re-exported through this module rather than imported directly at call sites,
 * so the implementation is swappable in one place — and so `uuidv7()` reads as
 * a project decision rather than a library detail.
 *
 * Why v7 and not `randomUUID()` (v4):
 *
 *   - **Index locality.** The leading 48 bits are a millisecond timestamp, so
 *     inserts land at the right edge of the B-tree instead of scattering across
 *     it — no page splits, less WAL amplification.
 *   - **A usable tiebreaker.** `now()` is evaluated once per transaction, so
 *     every row written in one transaction shares a `created_at`. Ordering then
 *     rests entirely on `id`: `ORDER BY created_at, id` on messages, and the
 *     `(created_at, id)` keyset cursor on sessions. With random ids that
 *     tiebreaker is noise, and rows come back in arbitrary order — for keyset
 *     pagination, that means silently skipped or repeated rows.
 *
 * Millisecond resolution alone is not enough, since a transaction completes
 * well inside one millisecond. RFC 9562 §6.2 covers it with a monotonic counter
 * in the `rand_a` bits; `uuid` implements that, so ids generated in the same
 * millisecond are still strictly increasing.
 *
 * Still unguessable: most of the remaining bits are random, so ids cannot be
 * enumerated the way a sequential integer key can.
 */
export { v7 as uuidv7 } from "uuid";
