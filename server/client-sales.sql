ALTER TABLE solution_sales_stages ADD COLUMN color INTEGER NOT NULL DEFAULT 0;
UPDATE solution_sales_stages SET color=position%6;
INSERT INTO solution_sales_stages(id,name,position,color) SELECT 'signed','Signed',coalesce(max(position),0)+1,5 FROM solution_sales_stages;

ALTER TABLE delivery_projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'field-notes';
ALTER TABLE delivery_projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE delivery_projects ADD COLUMN deleted_at TEXT;
ALTER TABLE delivery_stages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
UPDATE delivery_projects SET icon=CASE id WHEN 'onboarding' THEN 'desk-bell' WHEN 'introductions' THEN 'room-key'
  WHEN 'follow-ups' THEN 'correspondence' ELSE 'field-notes' END;

CREATE TABLE engagement_requests (
  actor_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL REFERENCES engagements(id), PRIMARY KEY(actor_id,request_id)
) STRICT;
