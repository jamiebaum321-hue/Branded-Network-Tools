-- Approvals queue: proposals (email drafts, record updates, notes) that a person approves or rejects.
-- Nothing in the app sends email; an approved draft is opened in the approver's own mail app.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  client_id TEXT REFERENCES clients(id),
  kind TEXT NOT NULL CHECK (kind IN ('email_draft','record_update','note')),
  trigger TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','done')),
  title TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}' CHECK (payload::jsonb IS NOT NULL),
  result TEXT NOT NULL DEFAULT '',
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX approvals_queue ON approvals(status, created_at DESC);
CREATE INDEX approvals_client ON approvals(client_id, created_at DESC);

-- Activity log: what changed on each account and where the fact came from.
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  company_label TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  review INTEGER NOT NULL DEFAULT 0 CHECK (review IN (0,1)),
  message_ids TEXT NOT NULL DEFAULT '[]' CHECK (message_ids::jsonb IS NOT NULL),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX activity_log_time ON activity_log(at DESC, id);
CREATE INDEX activity_log_client ON activity_log(client_id, at DESC);
CREATE INDEX activity_log_review ON activity_log(review, at DESC) WHERE review = 1;
