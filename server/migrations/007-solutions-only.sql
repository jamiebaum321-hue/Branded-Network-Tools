-- Keep the workspace strictly to the Solutions tracker.

-- Activity log: keep only entries tied to a Solutions client; drop workspace-wide automation notes
-- and anything the sync itself labelled as Capital, Media, Events or "not Solutions".
DELETE FROM activity_log
WHERE client_id IS NULL
   OR text ~* '(not solutions|no solutions change)'
   OR text ~* '^(capital|media|events|media/events|internal)\M';

-- Approvals: the imported queue was stale automation to-dos from the old tracker; clear it.
DELETE FROM approvals WHERE dedupe_key LIKE 'solutions-tracker:%';

-- Client records: drop AI weekly briefs, market intel, onboarding checklists and KPI blurbs.
DELETE FROM client_records WHERE kind IN ('briefs', 'intel', 'onboarding', 'kpis');
DELETE FROM imported_records WHERE kind = 'client_records'
  AND NOT EXISTS (SELECT 1 FROM client_records r WHERE r.id = imported_records.local_id);
DELETE FROM imported_records WHERE kind IN ('approvals', 'activity_log')
  AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.id = imported_records.local_id)
  AND NOT EXISTS (SELECT 1 FROM activity_log l WHERE l.id = imported_records.local_id);
