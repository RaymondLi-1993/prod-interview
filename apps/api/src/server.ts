import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { closePool } from "./db/pool.ts";

/**
 * Process lifecycle. Separate from `app.ts` so tests can build an app without
 * binding a port.
 */

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`listening on http://localhost:${String(env.PORT)}`);
});

/**
 * Graceful shutdown.
 *
 * On SIGTERM a container gets a grace period before SIGKILL. Exiting
 * immediately would drop in-flight requests and leave database connections
 * open on the server side, so: stop accepting new connections, let existing
 * requests finish, then close the pool.
 */
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received, shutting down`);

  // Force-exit if a hung request keeps the server from closing. Ten seconds
  // is comfortably inside a typical container grace period.
  const timer = setTimeout(() => {
    console.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  timer.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();

  console.log("shutdown complete");
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

/**
 * A rejection nobody handled means state is unknown — the safe move is to
 * crash and let the supervisor restart, not to limp along.
 */
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection", reason);
  process.exit(1);
});
