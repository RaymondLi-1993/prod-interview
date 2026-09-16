# prod-interview

An AI-powered mock interview platform. A session runs as a staged interview —
introduction → coding → system design → behavioral — with an LLM acting as the
interviewer and producing a structured report at the end.

**Status: in progress.** The schema and data-access layer are built and tested;
the HTTP API, LLM integration, and frontend are not yet started.

---

## Stack

|                 |                                                 |
| --------------- | ----------------------------------------------- |
| Runtime         | Node 22, TypeScript (strict), ESM               |
| Database        | PostgreSQL 17 (Supabase)                        |
| Data access     | Raw SQL via `pg` — no ORM                       |
| Validation      | Zod, at the repository boundary                 |
| Migrations      | Hand-written SQL, `node-pg-migrate`             |
| Tests           | Vitest, integration tests against real Postgres |
| API _(planned)_ | Express 5                                       |

---

## Running it

Requires Node 22+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL
npm run migrate:up            # create the schema
npm run seed                  # load development data
```

| Command                        |                                      |
| ------------------------------ | ------------------------------------ |
| `npm test`                     | integration tests (needs a database) |
| `npm run typecheck`            | `tsc --noEmit` across all workspaces |
| `npm run lint`                 | ESLint with type-aware rules         |
| `npm run migrate:up` / `:down` | apply / roll back one migration      |
| `npm run seed`                 | idempotent development data          |

Using Supabase: take the **session pooler** connection string (port 5432), not
the transaction pooler — this is a long-lived process with its own `pg.Pool`,
and the transaction pooler does not support prepared statements.

---

## Layout

```
apps/api/src/
  config/     env parsing (Zod) — the only reader of process.env
  db/         pool, transaction helper, shared types
  modules/    vertical slices: sessions/, users/
packages/shared/   request/response contract shared with the future client
db/migrations/     hand-written SQL, up and down
docs/              design notes
```

Code is organised **by feature, not by layer** — `modules/sessions/` holds its
own repository, schemas, and (later) service and routes. Vertical slices stay
navigable as a codebase grows; `controllers/` + `services/` + `models/` folders
mean editing four directories for every change.

---

## Architecture

Every request will flow through exactly these layers:

```
route        → HTTP wiring + request validation. No logic.
controller   → HTTP concerns only: status codes, headers, response shape.
service      → Business logic, orchestration, transactions.
repository   → SQL, and only SQL. Returns validated domain objects.
```

Services never import from `express` or touch `req`/`res`; repositories never
contain business logic or know that HTTP exists. That constraint is what makes
services testable against a fake repository, and it is why most tests will live
at that layer.

---

## Design notes

[`docs/schema-draft.md`](docs/schema-draft.md) documents every table with the
reasoning behind it. Some of the decisions worth calling out:

**Stages are rows, not columns.** A session has four ordered stages, each with
its own status and timings. Modelling that as `intro_status`,
`intro_started_at`, `coding_status`, … would be thirteen columns doing the work
of four rows — a _repeating group_, and the standard signal that something wants
to be a table. It also gives `messages.stage_id` a real foreign key to point at.

**Partial unique indexes enforce state-machine rules.** One in-progress session
per user, and one active stage per session:

```sql
CREATE UNIQUE INDEX uq_sessions_one_active_per_user
  ON sessions (user_id)
  WHERE status = 'in_progress' AND deleted_at IS NULL;
```

An application-level check cannot close this: check-then-insert is a
time-of-check/time-of-use race, and two fast clicks would both pass. Only the
database serialises the write.

**Soft delete breaks uniqueness unless the index is scoped.** In Postgres a
unique constraint _is_ an index, so uniqueness is checked against index entries
rather than table rows. A soft-deleted user still occupies `UNIQUE (email)` and
could never re-register with their own address. Every unique constraint on a
soft-deleted table is a partial index on `WHERE deleted_at IS NULL`.

**Auth identity is a mapping we own.** `users.id` is a surrogate key; the
provider's subject is stored alongside it as `(auth_provider,
auth_provider_id)`. Using the provider's ID as the primary key would embed a
vendor's identifier in every foreign key in the database.

**Keyset pagination, never `OFFSET`.** `OFFSET 10000` makes Postgres scan and
discard 10,000 rows, and concurrent inserts shift the window so users see
duplicates or skips. `WHERE (created_at, id) < ($1, $2)` seeks straight into an
index whose column order matches the `ORDER BY`.

---

## Testing

Repositories are covered by **integration tests against a real database** — a
mocked driver proves the SQL string is unchanged, not that it is correct. Each
test runs inside a transaction that is always rolled back, so tests create
their own data and leave nothing behind.

The bar is not "does the test pass" but "would it fail if the query were
wrong." Breaking a query on purpose and confirming the right test fails
(mutation testing) is how that gets verified.

---

## Roadmap

|                |                                                                    |
| -------------- | ------------------------------------------------------------------ |
| ✅ Foundations | workspaces, strict TS, lint, env parsing                           |
| ✅ Schema      | migrations, constraints, indexes, seed data                        |
| 🔨 Data access | pool, transactions, repositories, Zod row schemas                  |
| Core API       | Express, error handling, session lifecycle, stage state machine    |
| LLM            | adapter behind an interface, SSE streaming, transcript persistence |
| Auth           | provider-issued JWTs, ownership authorization                      |
| Execution      | sandboxed code execution with enforced resource limits             |
| Frontend       | React client, streaming UI, editor                                 |
| Hardening      | structured logging, metrics, rate limiting, CI, deploy             |
