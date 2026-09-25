import { randomBytes } from "node:crypto";

/**
 * UUIDv7 — a time-ordered UUID, per the locked decision in CLAUDE.md §3.
 *
 * Layout (RFC 9562):
 *
 *   ┌─ 48 bits ─────────┬─ 4 ─┬─ 12 ──┬─ 2 ─┬─ 62 bits ─────────┐
 *   │ unix_ts_ms        │ ver │ rand_a│ var │ rand_b            │
 *   └───────────────────┴─────┴───────┴─────┴───────────────────┘
 *
 * The leading 48 bits are the Unix timestamp in milliseconds, so lexical order
 * matches creation order. That is what `randomUUID()` (UUIDv4) does not give
 * us, and it buys two things this codebase already depends on:
 *
 *   - **Index locality.** Inserts land at the right edge of the B-tree rather
 *     than scattering across it, avoiding page splits and WAL amplification.
 *   - **A meaningful tiebreaker.** Keyset pagination orders by
 *     `(created_at, id)`, and `ORDER BY created_at, id` on messages relies on
 *     `id` to break ties. With random ids that tiebreaker is noise: two rows
 *     sharing a timestamp can come back in either order, which is exactly the
 *     skip/duplicate problem keyset pagination exists to prevent. Ties are not
 *     hypothetical — `now()` is evaluated once per transaction, so every row
 *     inserted in one transaction shares a `created_at`.
 *
 * Still unguessable: 74 of the 128 bits are random, so ids cannot be
 * enumerated the way a sequential integer key can.
 */
/**
 * Millisecond resolution is not enough on its own: ids generated inside the
 * same millisecond would differ only in their random bits, so their relative
 * order would be arbitrary — and that is exactly the case that matters, since
 * several rows are often inserted in one transaction.
 *
 * RFC 9562 §6.2 method 1 covers this: use the 12 `rand_a` bits as a counter
 * that increments within a millisecond and reseeds when the clock advances.
 * Seeded randomly (below half) rather than at zero so ids stay unguessable and
 * there is headroom before overflow.
 */
let lastMs = 0;
let counter = 0;

export function uuidv7(): string {
  const bytes = randomBytes(16);

  const now = Date.now();
  if (now === lastMs) {
    counter += 1;
    // 12 bits exhausted in one millisecond (4096 ids/ms). Spilling into the
    // timestamp would break ordering, so borrow from the next millisecond
    // instead — ids stay unique and monotonic, at most slightly ahead.
    if (counter > 0xfff) {
      lastMs += 1;
      counter = randomBytes(2).readUInt16BE(0) & 0x7ff;
    }
  } else {
    lastMs = Math.max(now, lastMs);
    counter = randomBytes(2).readUInt16BE(0) & 0x7ff;
  }

  // Bytes 0-5: 48-bit big-endian millisecond timestamp.
  const timestamp = BigInt(lastMs);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((timestamp >> BigInt(8 * (5 - i))) & 0xffn);
  }

  // Byte 6: version 7 in the high nibble, top 4 counter bits in the low nibble.
  // Byte 7: the remaining 8 counter bits.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // Byte 8, top two bits: RFC 9562 variant (0b10). Remaining 62 bits random.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
