-- Up Migration

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

CREATE TABLE messages (
  id          uuid PRIMARY KEY,
  stage_id    uuid NOT NULL REFERENCES session_stages(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('interviewer','candidate')),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_stage_created
  ON messages (stage_id, created_at, id);

-- Down Migration

DROP TABLE messages;
DROP TABLE session stages