-- Up Migration

-- users table
CREATE TABLE users (
  id                uuid PRIMARY KEY,

  auth_provider     text NOT NULL CHECK (auth_provider IN ('supabase', 'google', 'github')),
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

-- sessions table

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
-- Down Migration

DROP TABLE sessions;
DROP TABLE users;


