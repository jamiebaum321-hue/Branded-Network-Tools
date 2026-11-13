-- Per-client working records carried over from the Solutions tracker: issues, onboarding checklist items,
-- monthly KPIs and reports, billing, market intel, weekly intel briefs and weekly wins.
-- Issues may also belong to the whole workspace (no client).
CREATE TABLE client_records (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  kind TEXT NOT NULL CHECK (kind IN ('issues','onboarding','kpis','reports','billing','intel','briefs','wins')),
  record_key TEXT,
  data TEXT NOT NULL CHECK (data::jsonb IS NOT NULL),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  CHECK (client_id IS NOT NULL OR kind = 'issues')
);
CREATE UNIQUE INDEX client_records_key ON client_records(client_id, kind, record_key) WHERE record_key IS NOT NULL;
CREATE INDEX client_records_client ON client_records(client_id, kind, created_at);
CREATE INDEX client_records_kind ON client_records(kind, created_at);
