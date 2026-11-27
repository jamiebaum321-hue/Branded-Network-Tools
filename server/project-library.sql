CREATE TABLE solution_sales_stages (
  id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, position INTEGER NOT NULL
) STRICT;
INSERT INTO solution_sales_stages VALUES
 ('outreach','Outreach',0),('discovery','Discovery',1),('first_engagement','First engagement',2),
 ('second_engagement','Second engagement',3),('agreement_sent','Agreement sent',4);
CREATE TABLE delivery_projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  cadence TEXT NOT NULL CHECK(cadence IN ('once','week','month')),
  all_clients INTEGER NOT NULL DEFAULT 0, creator TEXT REFERENCES users(id), position INTEGER NOT NULL
) STRICT;
CREATE TABLE delivery_project_clients (
  project_id TEXT NOT NULL REFERENCES delivery_projects(id), client_id TEXT NOT NULL REFERENCES clients(id),
  PRIMARY KEY(project_id,client_id)
) STRICT;
CREATE TABLE delivery_stages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES delivery_projects(id), name TEXT NOT NULL COLLATE NOCASE,
  phase TEXT NOT NULL, cadence TEXT NOT NULL CHECK(cadence IN ('once','week','month')), position INTEGER NOT NULL,
  UNIQUE(project_id,name)
) STRICT;
INSERT INTO delivery_projects VALUES
 ('onboarding','Onboarding','From signed agreement to an approved delivery plan.','once',1,NULL,1),
 ('weekly-report','Weekly report','Prepare, review and deliver the client update.','week',1,NULL,2),
 ('introductions','Introductions','From a target shortlist to the first outreach and handoff.','once',1,NULL,3),
 ('follow-ups','Client follow-ups','Track the first five follow-ups and ongoing monthly check-ins.','month',1,NULL,4);
INSERT INTO delivery_stages VALUES
 ('intake','onboarding','Intake received','Intake','once',1),
 ('asset_review','onboarding','Assets reviewed','Intake','once',2),
 ('team_confirmed','onboarding','Key contacts confirmed','Intake','once',3),
 ('goals','onboarding','Growth goals agreed','Kickoff','once',4),
 ('deliverables','onboarding','Deliverables agreed','Kickoff','once',5),
 ('kickoff','onboarding','Kickoff email sent','Kickoff','once',6),
 ('plan_approved','onboarding','Delivery plan approved','Kickoff','once',7),
 ('report','weekly-report','First report delivered','Launch','once',1),
 ('weekly_collect','weekly-report','Activity collected','Preparation','week',2),
 ('weekly_metrics','weekly-report','Results verified','Preparation','week',3),
 ('weekly_draft','weekly-report','Report drafted','Preparation','week',4),
 ('weekly_review','weekly-report','Owner review complete','Delivery','week',5),
 ('weekly_sent','weekly-report','Weekly report delivered','Delivery','week',6),
 ('target_shortlist','introductions','Priority targets shortlisted','Preparation','once',1),
 ('channel_check','introductions','Channel partners reviewed','Preparation','once',2),
 ('intro_owner','introductions','Relationship owners confirmed','Preparation','once',3),
 ('icp','introductions','Initial contact sent to ICPs','Outreach','once',4),
 ('warm_intro','introductions','First warm introduction made','Outreach','once',5),
 ('handoff','introductions','Next steps confirmed','Outreach','once',6),
 ('follow_1','follow-ups','First follow-up','Outreach','once',1),
 ('follow_2','follow-ups','Second follow-up','Outreach','once',2),
 ('follow_3','follow-ups','Third follow-up','Outreach','once',3),
 ('follow_4','follow-ups','Fourth follow-up','Outreach','once',4),
 ('follow_5','follow-ups','Fifth follow-up','Outreach','once',5),
 ('monthly','follow-ups','Monthly follow-up','Ongoing','month',6);
ALTER TABLE client_connections ADD COLUMN added_at TEXT;
UPDATE client_connections SET added_at=(SELECT min(at) FROM audit_log WHERE client_id=client_connections.client_id
  AND entity_id=client_connections.node_key AND action='connection.saved');
CREATE INDEX project_cells_by_step ON project_steps(step,period,client_id);
