/**
 * Runs once before any test file.
 *
 * `config/env.ts` parses process.env at import time and exits if DATABASE_URL
 * is missing, so the file has to be loaded before anything imports the pool.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../../../.env");

for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;

  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;

  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();

  process.env[key] ??= value;
}
