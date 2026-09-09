import pg from "pg";
import { env } from "../config/env.js";

/**
 * The single connection pool for the process.
 *
 * Opening a Postgres connection is expensive — TCP, TLS, auth, and a forked
 * backend process on the server — so connections are opened once and reused
 * across requests rather than created per query.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,

  // Supabase's session pooler caps connections per project. Ten is ample for
  // a single dev process and leaves headroom for migrations and psql.
  max: 10,

  // Return a connection to the pool after 30s idle.
  idleTimeoutMillis: 30_000,

  // Fail fast if the pool cannot hand out a connection — a request waiting
  // indefinitely for a connection is worse than a request that errors.
  connectionTimeoutMillis: 5_000,
});

/**
 * A pooled connection can die between checkouts (network blip, server
 * restart). `pg` emits those on the pool itself, and an unhandled 'error'
 * event on an EventEmitter crashes the process.
 */
pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err.message);
});

/** Closes every connection. Called once, during graceful shutdown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
