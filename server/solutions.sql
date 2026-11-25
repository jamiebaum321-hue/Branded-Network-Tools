ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE report_versions ADD COLUMN sent_at TEXT;
UPDATE report_versions SET sent_at=coalesce(
  (SELECT min(at) FROM audit_log WHERE entity='report' AND entity_id=report_versions.id AND action='report.sent'),
  (SELECT min(attempted_at) FROM dispatches WHERE report_id=report_versions.id AND status='accepted')
) WHERE status='sent';

CREATE TABLE attachment_lists (
  file_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE, rows TEXT NOT NULL CHECK(json_valid(rows)), note TEXT NOT NULL
) STRICT;

CREATE TABLE project_briefs (
  client_id TEXT PRIMARY KEY REFERENCES clients(id), goals TEXT NOT NULL, deliverables TEXT NOT NULL, version INTEGER NOT NULL
) STRICT;
CREATE TABLE project_steps (
  client_id TEXT NOT NULL REFERENCES clients(id), step TEXT NOT NULL, period TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, owner_id TEXT REFERENCES users(id), due TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(client_id,step,period)
) STRICT;
CREATE TABLE client_connections (
  client_id TEXT NOT NULL REFERENCES clients(id), node_key TEXT NOT NULL, company TEXT NOT NULL, person TEXT NOT NULL,
  category TEXT NOT NULL, health TEXT NOT NULL, stage TEXT NOT NULL, next_action TEXT NOT NULL,
  due TEXT NOT NULL, owner_id TEXT REFERENCES users(id), notes TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY(client_id,node_key)
) STRICT;
CREATE TABLE client_notes (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), body TEXT NOT NULL, author TEXT NOT NULL,
  created_at TEXT NOT NULL, company TEXT NOT NULL, person TEXT NOT NULL, category TEXT NOT NULL,
  source_key TEXT NOT NULL, UNIQUE(client_id,source_key)
) STRICT;
CREATE INDEX client_notes_by_client ON client_notes(client_id,created_at);
CREATE TABLE client_people (
  client_id TEXT NOT NULL REFERENCES clients(id), person_key TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  email TEXT NOT NULL, phone TEXT NOT NULL, title TEXT NOT NULL, department TEXT NOT NULL, notes TEXT NOT NULL,
  version INTEGER NOT NULL, PRIMARY KEY(client_id,person_key)
) STRICT;

INSERT INTO work_items(id,engagement_id,kind,title,status,recorded_at,actor)
  SELECT lower(hex(randomblob(16))),id,'note',
    CASE stage WHEN 'discussion' THEN 'Previously in discussion' ELSE 'First meeting was scheduled' END,
    'done',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'System'
  FROM engagements WHERE line='solutions' AND stage IN ('discussion','first_meeting_scheduled');
UPDATE engagements SET stage='first_engagement',version=version+1
  WHERE line='solutions' AND stage IN ('discussion','first_meeting_scheduled');
