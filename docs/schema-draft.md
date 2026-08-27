# Schema draft

Working design for the Level 1 schema. **This is a draft, not a migration.**
It becomes real SQL in `db/migrations/` once Level 0 closes.

Tables are added here as they are designed. Each records not just the DDL but
the reasoning, so decisions are reviewable later.

Method used for every table:

```
1. What is one row?    state it in a single sentence
2. Identity            natural key? surrogate key? both?
3. Relationships       cardinality, and which side holds the FK
4. Attributes          columns and types
5. Invariants          what must always be true — as constraints
6. Indexes             derived from access patterns, never guessed
```

---

## Status

| Table | State |
|---|---|
| `users` | not started |
| `sessions` | ✅ designed |
| `session_stages` | 🟡 one open question (timers) |
| `messages` | not started |
| `problems` | not started |
| `coding_submissions` | not started |
| `session_reports` | not started |
| `stage_evaluations` | not started |

---

## `sessions`

**One row = one attempt at one mock interview by one user.**

```sql
CREATE TABLE sessions (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track       text NOT NULL CHECK (track IN ('frontend','react','backend')),
  difficulty  text NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  status      text NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','abandoned')),
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  CONSTRAINT chk_sessions_ended_at CHECK (
    status = 'in_progress' OR ended_at IS NOT NULL
  ),
  CONSTRAINT chk_sessions_time_order CHECK (
    ended_at IS NULL OR ended_at >= created_at
  )
);

CREATE UNIQUE INDEX uq_sessions_one_active_per_user
  ON sessions (user_id)
  WHERE status = 'in_progress' AND deleted_at IS NULL;

CREATE INDEX idx_sessions_user_created
  ON sessions (user_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
```

### Decisions

**No natural key.** A user can legitimately start Frontend/Medium twice in the
same second. Surrogate PK only.

**No `current_stage` column.** It is derivable from
`session_stages WHERE status = 'active'`, and that lookup is already backed by
an index. Storing it too would be denormalization that can drift.

**`ended_at`, not `completed_at`.** There are three terminal-ish statuses and
`abandoned` needs a timestamp too. The constraint reads cleanly as *anything not
in progress has an end time*.

**No `started_at`.** It would always equal `created_at`. Redundant columns rot.

**`ON DELETE CASCADE` on `user_id`.** Two deletion paths, deliberately:
soft delete (`deleted_at`) is "deactivate my account" and preserves sessions;
hard delete is GDPR erasure and cascades everything away. Cascade must stay
consistent all the way down the chain or erasure fails.

**`uq_sessions_one_active_per_user` is a rule, not an optimization.** A user
must finish or end their current interview before starting another. Enforced by
a *partial unique index* — Postgres has no conditional-unique-constraint syntax.
An application-level check cannot close this: check-then-insert is a
time-of-check/time-of-use race, and two fast clicks would both pass. The service
still checks for a friendly message; the index is what makes it true. Catch
Postgres `23505` and map it to HTTP 409.

**Both indexes are partial on `deleted_at IS NULL`.** Soft deletes break unique
constraints unless scoped — otherwise a soft-deleted in-progress session would
block the user forever. It also keeps deleted rows out of the pagination index.

**`idx_sessions_user_created` column order mirrors the query's `ORDER BY`**, so
Postgres seeks instead of sorting. `id DESC` is a tiebreaker: without a total
ordering, keyset pagination can silently skip or repeat rows.

**No standalone FK index on `user_id`** — the composite index already leads with
it, and Postgres can use any leftmost prefix.

**`updated_at` needs a trigger.** `DEFAULT now()` only fires on insert. One
shared trigger function, written in the first migration.

---

## `session_stages`

**One row = one stage within one session.** Four rows per interview.

```sql
CREATE TABLE session_stages (
  id            uuid PRIMARY KEY,
  session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN
                  ('introduction','coding','system_design','behavioral')),
  position      int  NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','active','completed')),

  started_at    timestamptz,
  completed_at  timestamptz,
  working_state jsonb NOT NULL DEFAULT '{}',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id, position)
);
```

### Decisions

**A table, not a `sessions.current_stage` column.** The column version needs
`intro_status`, `intro_started_at`, `intro_completed_at`, and the same for three
more stages — thirteen columns doing the work of four rows. That shape is a
*repeating group*, the standard signal that something wants to be a table. It
also gives `messages.stage_id` a real foreign key to point at.

**Four rows, not one mutating row.** Updating `kind` as the user advances
overwrites the previous stage's timings, so by the end three of four stages have
left no trace — and the end-of-session report scores all four. Messages would
also all share one `stage_id`, making "show me the behavioral round" impossible.
*Updating a row destroys the past; inserting rows preserves it.*

**Natural key exists here:** `(session_id, position)`. Declared `UNIQUE`
alongside the surrogate PK — the surrogate is for joining, the unique constraint
is for integrity.

**Deliberately NOT declaring `UNIQUE (session_id, kind)`.** True today, but only
because the sequence is fixed. Encoding it would forbid a two-coding-round
interview without a migration. *Constrain what must always be true, not what
merely happens to be true right now.*

**Status is one column, not four booleans.** A stage is in exactly one state;
four booleans permit `is_active AND is_completed` simultaneously. One column
with a `CHECK` makes illegal states unrepresentable.

**No `failed` status.** That is an *outcome*, not a lifecycle state — it belongs
in `stage_evaluations` as a score. A status column tracks where something is in
its lifecycle, never how well it went. Mixing them makes "completed, but scored
poorly" unrepresentable.

**No `abandoned` or `skipped` status.** Users cannot skip stages — they continue
or exit. And when a session is abandoned mid-coding, `sessions.status` already
records it; copying that fact into the stage row creates two places storing one
truth that can drift. *Do not denormalize a parent's state into its children
unless you query the children independently.* Pending stages in an abandoned
session simply stay `pending`, which is accurate — they never started.

**`started_at` earns its place here** (unlike on `sessions`). All four rows are
created when the session starts, but stage 3 may not begin for 45 minutes.

**`working_state jsonb`** holds the half-written solution and editor state.
Read only alongside its stage, never queried across sessions — *structure what
you query, blob what you only read*. `DEFAULT '{}'` so it is never null-checked.

### Open question

**Timers under resumption.** The coding stage is 35 minutes; the user closes the
tab at minute 20 and returns tomorrow. Does the clock keep running?

- **Wall time** — `started_at` alone suffices. Simple, but stepping away for
  lunch costs the interview.
- **Active time only** — needs an accumulated `elapsed_seconds` column plus
  client heartbeats. Fairer, but real machinery.

Indexes are not yet chosen for this table; they follow once the timer question
settles.
