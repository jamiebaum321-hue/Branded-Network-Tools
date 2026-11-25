CREATE TABLE workspace_members (
  user_id TEXT NOT NULL REFERENCES users(id), line TEXT NOT NULL CHECK(line IN ('solutions','media','capital')),
  PRIMARY KEY(user_id,line)
) STRICT;
CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE engagements (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), line TEXT NOT NULL CHECK(line IN ('solutions','media','capital')),
  owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, stage TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id), signed_at TEXT, details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX engagements_board ON engagements(line,stage,owner_id);
CREATE INDEX engagements_client ON engagements(client_id);
CREATE TABLE campaign_targets (
  line TEXT NOT NULL, campaign TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id),
  engagement_id TEXT NOT NULL REFERENCES engagements(id), PRIMARY KEY(line,campaign,company_id)
) STRICT;
CREATE TABLE engagement_members (
  engagement_id TEXT NOT NULL REFERENCES engagements(id), user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(engagement_id,user_id)
) STRICT;
CREATE TABLE work_items (
  id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL REFERENCES engagements(id), kind TEXT NOT NULL,
  title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, due TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL, actor TEXT NOT NULL, source_key TEXT, external_ref TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES users(id),
  audience TEXT NOT NULL DEFAULT 'internal' CHECK(audience IN ('internal','client')),
  UNIQUE(engagement_id,source_key)
) STRICT;
CREATE INDEX work_items_engagement ON work_items(engagement_id,recorded_at);
CREATE TABLE work_history (
  seq INTEGER PRIMARY KEY, item_id TEXT NOT NULL REFERENCES work_items(id), status TEXT NOT NULL, notes TEXT NOT NULL, at TEXT NOT NULL
) STRICT;
CREATE INDEX work_history_at ON work_history(item_id,at DESC,seq DESC);
CREATE TRIGGER work_created AFTER INSERT ON work_items BEGIN
  INSERT INTO work_history(item_id,status,notes,at) VALUES(NEW.id,NEW.status,NEW.notes,NEW.recorded_at);
END;
CREATE TRIGGER work_edited AFTER UPDATE OF status,notes ON work_items BEGIN
  INSERT INTO work_history(item_id,status,notes,at) VALUES(NEW.id,NEW.status,NEW.notes,NEW.recorded_at);
END;
CREATE TABLE report_versions (
  id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL REFERENCES engagements(id), start_day TEXT NOT NULL,
  end_day TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  source_key TEXT, UNIQUE(engagement_id,source_key)
) STRICT;
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, client_id TEXT REFERENCES clients(id), engagement_id TEXT REFERENCES engagements(id),
  form_key TEXT REFERENCES form_links(token_hash), submission_id TEXT REFERENCES submissions(id), purpose TEXT NOT NULL,
  name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL,
  CHECK((form_key IS NOT NULL AND client_id IS NOT NULL) OR engagement_id IS NOT NULL)
) STRICT;
CREATE INDEX attachments_intake ON attachments(client_id,form_key,submission_id);
CREATE INDEX attachments_deal ON attachments(engagement_id);
CREATE TABLE introduction_research (
  suggestion_id TEXT PRIMARY KEY REFERENCES suggestions(id), tier TEXT NOT NULL,
  next_action TEXT NOT NULL, research TEXT NOT NULL
) STRICT;
CREATE TABLE dispatches (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, engagement_id TEXT REFERENCES engagements(id),
  pitch_id TEXT, report_id TEXT REFERENCES report_versions(id), kind TEXT NOT NULL, recipient TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, attempted_at TEXT, try_after INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE guest_pitches (
  id TEXT PRIMARY KEY, thread_key TEXT NOT NULL UNIQUE, sender TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id), status TEXT NOT NULL, received_at TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE mailbox_state (
  stream TEXT PRIMARY KEY, cursor TEXT NOT NULL, watermark TEXT NOT NULL
) STRICT;
CREATE TABLE unmatched_media_mail (
  source_key TEXT PRIMARY KEY, candidates TEXT NOT NULL CHECK(json_valid(candidates)), summary TEXT NOT NULL CHECK(json_valid(summary)),
  occurred_at TEXT NOT NULL, resolved_at TEXT, engagement_id TEXT REFERENCES engagements(id)
) STRICT;
CREATE TABLE inquiry_sources (
  id TEXT PRIMARY KEY, line TEXT NOT NULL, label TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE inquiry_entries (
  source_id TEXT NOT NULL REFERENCES inquiry_sources(id), request_id TEXT NOT NULL, engagement_id TEXT NOT NULL REFERENCES engagements(id),
  PRIMARY KEY(source_id, request_id)
) STRICT;
INSERT OR IGNORE INTO workspace_members SELECT owner_id,'solutions' FROM clients;
INSERT OR IGNORE INTO workspace_members SELECT user_id,'solutions' FROM client_members;
INSERT OR IGNORE INTO companies SELECT id,name,lower(trim(name)) FROM clients ORDER BY created_at,id;
INSERT INTO engagements(id,company_id,line,owner_id,title,stage,client_id,created_at,updated_at)
  SELECT c.id,co.id,'solutions',c.owner_id,c.name,'active',c.id,c.created_at,c.created_at
  FROM clients c JOIN companies co ON co.name_key=lower(trim(c.name));
INSERT INTO engagement_members SELECT client_id,user_id FROM client_members;
CREATE TRIGGER solutions_owner_access AFTER INSERT ON clients BEGIN
  INSERT OR IGNORE INTO workspace_members VALUES(NEW.owner_id,'solutions');
END;
CREATE TRIGGER solutions_member_access AFTER INSERT ON client_members BEGIN
  INSERT OR IGNORE INTO workspace_members VALUES(NEW.user_id,'solutions');
END;
CREATE TRIGGER solutions_transfer_access AFTER UPDATE OF owner_id ON clients WHEN NEW.owner_id<>OLD.owner_id BEGIN
  INSERT OR IGNORE INTO workspace_members VALUES(NEW.owner_id,'solutions');
END;
