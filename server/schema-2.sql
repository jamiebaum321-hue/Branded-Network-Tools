-- Version 2: client lifecycle, client timeline and monthly reports.
ALTER TABLE clients ADD COLUMN stage TEXT NOT NULL DEFAULT 'delivering'
  CHECK (stage IN ('prospect','discovery','proposal','contract','won','onboarding','matching','delivering','lost','churned'));
ALTER TABLE clients ADD COLUMN stage_entered_at TEXT;
ALTER TABLE clients ADD COLUMN updated_at TEXT;
ALTER TABLE clients ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN contact_name TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN contact_title TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN monthly_value INTEGER;
ALTER TABLE clients ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN next_step TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN next_step_at TEXT;
ALTER TABLE clients ADD COLUMN started_on TEXT;
ALTER TABLE clients ADD COLUMN closed_reason TEXT NOT NULL DEFAULT '';
UPDATE clients SET stage_entered_at=created_at, updated_at=created_at;
CREATE INDEX clients_stage ON clients(stage, updated_at DESC, id);

CREATE TABLE client_timeline (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  kind TEXT NOT NULL CHECK (kind IN ('stage','note')),
  from_stage TEXT,
  stage TEXT,
  body TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  actor_id TEXT,
  at TEXT NOT NULL
) STRICT;
CREATE INDEX client_timeline_recent ON client_timeline(client_id, seq DESC);
INSERT INTO client_timeline(id,client_id,kind,stage,actor,at)
  SELECT lower(hex(randomblob(16))),id,'stage',stage,'System',created_at FROM clients;

CREATE TABLE report_entries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  kind TEXT NOT NULL CHECK (kind IN ('introduction','meeting','social','podcast','newsletter','email','event','press','other')),
  occurred_on TEXT NOT NULL CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  metrics TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics)),
  source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','claude')),
  source_key TEXT,
  actor TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX report_entries_month ON report_entries(client_id, occurred_on, created_at);
CREATE UNIQUE INDEX report_entries_key ON report_entries(client_id, source_key) WHERE source_key IS NOT NULL;

CREATE TABLE reports (
  client_id TEXT NOT NULL REFERENCES clients(id),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_id, period)
) STRICT;
