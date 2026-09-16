import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one database. Running files in parallel would
    // let concurrent transactions collide on the same rows, so tests run
    // sequentially in a single process.
    fileParallelism: false,

    // Loads .env before any test file, so DATABASE_URL is present when
    // config/env.ts parses it at import time.
    setupFiles: ["./apps/api/test/setup.ts"],

    include: ["apps/**/*.test.ts"],
  },
});
