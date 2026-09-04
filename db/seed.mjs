/**
 * Development seed data.
 *
 * Inserts one user, one in-progress session, its four stages, and a short
 * transcript for the completed introduction stage — enough to exercise every
 * read path the API will need before any endpoint exists.
 *
 * Idempotent: deletes the seed user first, and the cascade removes everything
 * beneath it. Safe to run repeatedly.
 *
 * Usage: npm run seed
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const SEED_EMAIL = "dev@prod-interview.local";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

/** Stage sequence is fixed (CLAUDE.md section 2). */
const STAGE_KINDS = ["introduction", "coding", "system_design", "behavioral"];

/** The introduction stage is finished; the coding stage is where we resume. */
const TRANSCRIPT = [
  ["interviewer", "Hi Raymond — thanks for making the time. To start, tell me a bit about your background."],
  ["candidate", "Sure. I'm a frontend engineer with about three and a half years of experience, mostly React and TypeScript. Lately I've been moving toward backend work."],
  ["interviewer", "What pulled you in that direction?"],
  ["candidate", "I kept hitting the edges of what I could reason about. I could build the UI, but I couldn't explain why an endpoint was slow or how the data was actually modelled underneath."],
  ["interviewer", "That's a good instinct. Let's put it to work — we'll move on to a coding problem next."],
];

async function main() {
  await client.connect();
  await client.query("BEGIN");

  // Cascade clears sessions -> stages -> messages.
  await client.query(`DELETE FROM users WHERE email = $1`, [SEED_EMAIL]);

  const userId = randomUUID();
  await client.query(
    `INSERT INTO users (id, auth_provider, auth_provider_id, email, display_name)
     VALUES ($1, 'supabase', $2, $3, 'Raymond')`,
    [userId, `seed-${userId}`, SEED_EMAIL],
  );

  const sessionId = randomUUID();
  await client.query(
    `INSERT INTO sessions (id, user_id, track, difficulty, status)
     VALUES ($1, $2, 'react', 'medium', 'in_progress')`,
    [sessionId, userId],
  );

  // Stage 1 completed, stage 2 active, the rest pending — the state a
  // returning user resumes into.
  const minutesAgo = (mins) => new Date(Date.now() - mins * 60_000);

  const stageIds = [];
  for (const [i, kind] of STAGE_KINDS.entries()) {
    const id = randomUUID();
    stageIds.push(id);

    const status = i === 0 ? "completed" : i === 1 ? "active" : "pending";
    const startedAt =
      i === 0 ? minutesAgo(40) : i === 1 ? minutesAgo(12) : null;
    const completedAt = i === 0 ? minutesAgo(12) : null;

    await client.query(
      `INSERT INTO session_stages
         (id, session_id, kind, position, status, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, sessionId, kind, i + 1, status, startedAt, completedAt],
    );
  }

  // Transcript belongs to the introduction stage.
  const introStageId = stageIds[0];
  for (const [offset, [role, content]] of TRANSCRIPT.entries()) {
    await client.query(
      `INSERT INTO messages (id, stage_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), introStageId, role, content, minutesAgo(40 - offset * 6)],
    );
  }

  // Draft code on the active coding stage — the resume state that must
  // survive a closed tab.
  await client.query(
    `UPDATE session_stages
        SET working_state = $2, updated_at = now()
      WHERE id = $1`,
    [
      stageIds[1],
      JSON.stringify({
        language: "typescript",
        draftCode:
          "function twoSum(nums: number[], target: number): number[] {\n  // TODO: hash map approach\n}\n",
      }),
    ],
  );

  await client.query("COMMIT");

  console.log("Seeded:");
  console.log(`  user     ${SEED_EMAIL}`);
  console.log(`  session  react / medium / in_progress`);
  console.log(`  stages   introduction=completed, coding=active, 2 pending`);
  console.log(`  messages ${TRANSCRIPT.length} in the introduction stage`);
}

try {
  await main();
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`Seed failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
