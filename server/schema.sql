CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  password_hash TEXT,
  oauth_subject TEXT UNIQUE,
  onboarding_alerts INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_alerts IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE setup_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX setup_user ON setup_tokens(user_id);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) STRICT;
CREATE INDEX rate_expiry ON rate_limits(expires_at);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE client_members (
  client_id TEXT NOT NULL REFERENCES clients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (client_id, user_id)
) STRICT;
CREATE INDEX client_members_user ON client_members(user_id, client_id);

CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  reviewer_id TEXT REFERENCES users(id),
  company TEXT NOT NULL,
  person TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (json_valid(evidence)),
  fit TEXT NOT NULL,
  branded_relationship TEXT NOT NULL,
  score REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed')),
  decision_at TEXT,
  decision_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(client_id, candidate_key)
) STRICT;
CREATE INDEX suggestions_review ON suggestions(client_id, status, score DESC, id);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  company TEXT NOT NULL,
  person TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL CHECK (stage IN ('to_contact','reached_out','in_conversation','closed')),
  next_step TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  fit_reason TEXT NOT NULL DEFAULT '',
  branded_relationship TEXT NOT NULL DEFAULT '',
  suggestion_id TEXT UNIQUE REFERENCES suggestions(id),
  entered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE INDEX cards_board ON cards(client_id, stage, updated_at DESC, id);
CREATE INDEX cards_owner ON cards(owner_id, stage, id);
CREATE TABLE followups (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','done','cancelled')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;
CREATE UNIQUE INDEX followups_one_open ON followups(card_id) WHERE status='pending';
CREATE INDEX followups_due ON followups(due_at, card_id) WHERE status='pending';
CREATE TABLE card_states (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  stage TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  due_at TEXT,
  recorded_at TEXT NOT NULL
) STRICT;
CREATE INDEX card_states_history ON card_states(card_id, recorded_at DESC, seq DESC);
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  followup_id TEXT REFERENCES followups(id),
  slot TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('claude','template','staff')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_review','needs_review','reviewed','sent','cancelled')),
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(card_id, slot)
) STRICT;
CREATE INDEX drafts_card ON drafts(card_id, status, updated_at DESC);
CREATE TABLE activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('sent','reply','note','stage','draft','introduction')),
  actor TEXT NOT NULL,
  actor_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
  mailbox_scope TEXT,
  outlook_message_id TEXT,
  occurred_at TEXT NOT NULL,
  logged_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX activity_message ON activity(kind, mailbox_scope, outlook_message_id) WHERE outlook_message_id IS NOT NULL;
CREATE INDEX activity_card ON activity(card_id, seq DESC);
CREATE INDEX activity_metrics ON activity(client_id, kind, occurred_at, owner_id);
CREATE INDEX activity_today ON activity(owner_id, kind, seq);
CREATE TABLE today_visits (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  reply_cursor INTEGER NOT NULL
) STRICT;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  version INTEGER NOT NULL,
  form_version INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT NOT NULL,
  answers TEXT NOT NULL CHECK (json_valid(answers)),
  source_ref TEXT,
  UNIQUE(client_id, version)
) STRICT;
CREATE TABLE form_links (
  token_hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  draft TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(draft)),
  submission_id TEXT REFERENCES submissions(id),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX form_links_client ON form_links(client_id, created_at DESC);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('follow_up_due','reply_logged','stage_changed','onboarding_submitted')),
  client_id TEXT NOT NULL REFERENCES clients(id),
  dedupe_key TEXT NOT NULL UNIQUE,
  record_id TEXT NOT NULL,
  card_id TEXT REFERENCES cards(id),
  title TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX events_client ON events(client_id, seq);
CREATE TABLE event_recipients (
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  seen_at TEXT,
  PRIMARY KEY (event_id, user_id)
) STRICT;
CREATE INDEX events_recipient ON event_recipients(user_id, seen_at);

CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  all_clients INTEGER NOT NULL CHECK (all_clients IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT
) STRICT;
CREATE TABLE mcp_clients (
  token_id TEXT NOT NULL REFERENCES mcp_tokens(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  PRIMARY KEY (token_id, client_id)
) STRICT;
CREATE TABLE mcp_writes (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  target TEXT NOT NULL,
  result TEXT NOT NULL CHECK (json_valid(result)),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  client_id TEXT REFERENCES clients(id),
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  at TEXT NOT NULL
) STRICT;
CREATE INDEX audit_actor ON audit_log(actor_id, seq DESC);
CREATE INDEX audit_action ON audit_log(action, seq DESC);
CREATE TABLE imported_records (
  namespace TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  PRIMARY KEY (namespace, kind, source_id)
) STRICT;
