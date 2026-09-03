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

| Table                | State       |
| -------------------- | ----------- |
| `users`              | ✅ designed |
| `sessions`           | ✅ designed |
| `session_stages`     | ✅ designed |
| `messages`           | ✅ designed |
| `problems`           | not started |
| `coding_submissions` | not started |
| `session_reports`    | not started |
| `stage_evaluations`  | not started |

---

## `users`

**One row = one person who can log in and own sessions.**

```sql
CREATE TABLE users (
  id                uuid PRIMARY KEY,

  auth_provider     text NOT NULL DEFAULT 'supabase',
  auth_provider_id  text NOT NULL,

  email             text NOT NULL,
  display_name      text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE UNIQUE INDEX uq_users_email
  ON users (email) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_users_provider_identity
  ON users (auth_provider, auth_provider_id) WHERE deleted_at IS NULL;
```

### Decisions

**One row is a person, not a login method.** If a row were one credential,
signing up with Google and later with GitHub would produce two rows — two
accounts, two split session histories, one confused human. Login methods are
attributes of a person, not the person's identity.

**Surrogate primary key, because nothing real is stable.** Emails change, names
change, providers get swapped. Any natural key eventually needs updating, and
updating a primary key means updating every referencing row in the database. A
meaningless generated ID never has to change. Natural keys still get `UNIQUE`
constraints — they protect integrity without carrying identity.

**`auth_provider_id` is translation, not verification.** Authentication never
touches the database: the JWT's signature is verified cryptographically against
Supabase's public key, with no network call and no lookup. Only _after_ the
token is trusted is `sub` used to find the local row. The flow is
`JWT sub → users.auth_provider_id → users.id`, and everything internal keys off
`users.id`.

**We own the mapping so the provider is swappable.** Using Supabase's ID as the
primary key would embed a vendor's identifier in every foreign key in the
database. Owning `id` means switching to Clerk or Auth0 is a one-column update.

**Uniqueness is on the pair `(auth_provider, auth_provider_id)`.** Every row
holds the same `auth_provider` value, so constraining that column alone would
cap the entire application at one user. The pair reads as _within a given
provider, each ID appears once_ — and it stays correct when a second provider
is added.

**No separate signup endpoint — just-in-time provisioning.** The first time an
unrecognized `sub` arrives, the row is created; every later login finds it.

**Both unique constraints are partial indexes, because soft delete breaks
uniqueness.** A soft-deleted user still occupies `UNIQUE (email)`, so they could
never re-register with their own address — blocked by a row they cannot see.
Scoping to `WHERE deleted_at IS NULL` frees the value. This applies to every
unique constraint on a soft-deleted table.

**Soft delete kept deliberately, with a known cost.** It is the one arguably
over-engineered column here: it adds `WHERE deleted_at IS NULL` to every query
and forces the partial indexes above. Kept because it is near-universal in
production codebases and it is a pattern worth learning. Hard delete remains the
GDPR erasure path and cascades everything away.

**No `password_hash`.** The provider owns credentials; we never see them.

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
`abandoned` needs a timestamp too. The constraint reads cleanly as _anything not
in progress has an end time_.

**No `started_at`.** It would always equal `created_at`. Redundant columns rot.

**`ON DELETE CASCADE` on `user_id`.** Two deletion paths, deliberately:
soft delete (`deleted_at`) is "deactivate my account" and preserves sessions;
hard delete is GDPR erasure and cascades everything away. Cascade must stay
consistent all the way down the chain or erasure fails.

**`uq_sessions_one_active_per_user` is a rule, not an optimization.** A user
must finish or end their current interview before starting another. Enforced by
a _partial unique index_ — Postgres has no conditional-unique-constraint syntax.
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

**`updated_at` is maintained in the application layer, not by a trigger.**
`DEFAULT now()` only fires on insert, so something must set it on every update.
A `BEFORE UPDATE` trigger would be automatic and unbypassable; it was rejected
because a trigger is action-at-a-distance — a column changes and nothing in the
codebase explains why. Instead every `UPDATE` composes its SET clause through a
shared helper that appends `updated_at = now()`.

Accepted cost: the helper only covers writes that go through application code.
Migrations, backfills, and manual psql sessions bypass it and leave
`updated_at` stale. Judged acceptable, since those are exactly the moments the
column matters least.

`now()` is always evaluated server-side — never send a timestamp from Node, or
the recorded value is the application server's clock rather than the database's.

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

CREATE UNIQUE INDEX uq_stages_one_active_per_session
  ON session_stages (session_id) WHERE status = 'active';
```

### Decisions

**A table, not a `sessions.current_stage` column.** The column version needs
`intro_status`, `intro_started_at`, `intro_completed_at`, and the same for three
more stages — thirteen columns doing the work of four rows. That shape is a
_repeating group_, the standard signal that something wants to be a table. It
also gives `messages.stage_id` a real foreign key to point at.

**Four rows, not one mutating row.** Updating `kind` as the user advances
overwrites the previous stage's timings, so by the end three of four stages have
left no trace — and the end-of-session report scores all four. Messages would
also all share one `stage_id`, making "show me the behavioral round" impossible.
_Updating a row destroys the past; inserting rows preserves it._

**Natural key exists here:** `(session_id, position)`. Declared `UNIQUE`
alongside the surrogate PK — the surrogate is for joining, the unique constraint
is for integrity.

**Deliberately NOT declaring `UNIQUE (session_id, kind)`.** True today, but only
because the sequence is fixed. Encoding it would forbid a two-coding-round
interview without a migration. _Constrain what must always be true, not what
merely happens to be true right now._

**Status is one column, not four booleans.** A stage is in exactly one state;
four booleans permit `is_active AND is_completed` simultaneously. One column
with a `CHECK` makes illegal states unrepresentable.

**No `failed` status.** That is an _outcome_, not a lifecycle state — it belongs
in `stage_evaluations` as a score. A status column tracks where something is in
its lifecycle, never how well it went. Mixing them makes "completed, but scored
poorly" unrepresentable.

**No `abandoned` or `skipped` status.** Users cannot skip stages — they continue
or exit. And when a session is abandoned mid-coding, `sessions.status` already
records it; copying that fact into the stage row creates two places storing one
truth that can drift. _Do not denormalize a parent's state into its children
unless you query the children independently._ Pending stages in an abandoned
session simply stay `pending`, which is accurate — they never started.

**`started_at` earns its place here** (unlike on `sessions`). All four rows are
created when the session starts, but stage 3 may not begin for 45 minutes.

**`working_state jsonb`** holds the half-written solution and editor state.
Read only alongside its stage, never queried across sessions — _structure what
you query, blob what you only read_. `DEFAULT '{}'` so it is never null-checked.

**No enforced time limit — duration is recorded, not policed.** A wall clock
would contradict resumability: returning the next day would open a stage that
expired sixteen hours ago, so either the timer is fake or resume is. Active-time
tracking would fix that but costs an accumulated `elapsed_seconds` column,
client heartbeats, and edge cases around unannounced tab closes and duplicate
tabs. Since this is a practice tool, `completed_at - started_at` gives the report
everything it needs ("you spent 34 minutes on a 25-minute problem") with zero
extra machinery. Revisit if simulating time pressure becomes a goal — the timing
columns are identical either way.

**Indexes are nearly free here.** A `UNIQUE` constraint is implemented as a
unique index, so `UNIQUE (session_id, position)` already serves both
"all stages for a session, in order" and any FK lookup on `session_id` via its
leftmost prefix. Only one index needs adding — and like its counterpart on
`sessions`, it does double duty as both the "resume where they left off" lookup
and the constraint making two active stages impossible.

---

## `messages`

**One row = one message in the conversation, sent by either the candidate or
the interviewer.**

```sql
CREATE TABLE messages (
  id          uuid PRIMARY KEY,
  stage_id    uuid NOT NULL REFERENCES session_stages(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('interviewer','candidate')),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_stage_created
  ON messages (stage_id, created_at, id);
```

### Decisions

**One table for both speakers, distinguished by `role`.** Not
`interviewer_messages` and `candidate_messages`. They hold the same shape of
data and differ only in who spoke, so splitting them would make "give me the
transcript in order" a `UNION` plus a sort instead of one indexed read.

**The FK points at `stage_id`, not `session_id`.** Access pattern #2 is _all
messages for a stage, in order_. Stages already belong to sessions, so the
session is always reachable through the stage — storing `session_id` too would
be a duplicated fact that can drift.

**No `user_id`.** Derivable via
`messages.stage_id → session_stages.session_id → sessions.user_id`. `role` is
not derivable and therefore earns its column: the same stage holds messages
from both parties.

**Row order is never inherent.** A `SELECT` without `ORDER BY` may return rows
in any order, and it changes as rows are updated or the table is vacuumed. Small
tables often _look_ ordered, which is what makes this a trap. Ordering is always
explicit.

**`ORDER BY created_at, id` rather than a `seq` column.** Two messages can share
a microsecond, and a tie resolves arbitrarily — so a tiebreaker is required. An
explicit sequence column would also work and is stricter, but it means computing
the next value on every insert, which is its own concurrency problem. UUIDv7 is
time-ordered, so `id` breaks the tie in roughly the right direction for free. A
`seq` column would only be worth it if messages needed reordering or guaranteed
gapless numbering — neither applies to a transcript.

**No `updated_at`** — messages are never edited. **No `deleted_at`** — they
cascade away with their session.

**Not included, deliberately:** token counts, which model produced an
interviewer message, and whether a response was partially streamed. All are
plausible later additions, and all are additive columns that cost nothing to
defer. Revisit at Level 4 when the LLM adapter is real.
