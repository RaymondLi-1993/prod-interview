import { z } from "zod";

/**
 * The single place `process.env` may be read (CLAUDE.md section 10).
 *
 * Parsing happens once, at import time. A missing or malformed variable
 * crashes the process on startup rather than surfacing as an undefined
 * halfway through a request — fail fast, and fail where it is obvious.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  // Session pooler connection string, not the transaction pooler:
  // this is a long-lived process managing its own pg.Pool.
  DATABASE_URL: z.string().url(),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Never log values — a malformed DATABASE_URL still contains a password.
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;
