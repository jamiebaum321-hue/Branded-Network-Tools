-- Liz has left Branded: hand everything she owned to Schatzy.

-- Account next steps and team lists.
UPDATE clients SET next_owner = 'Schatzy' WHERE next_owner ~* '^\s*liz\s*$';
UPDATE clients SET team = array_to_string(ARRAY(
    SELECT DISTINCT ON (lower(name)) name FROM (
      SELECT CASE WHEN trim(part) ~* '^liz$' THEN 'Schatzy' ELSE trim(part) END AS name, ord
      FROM unnest(string_to_array(team, ',')) WITH ORDINALITY AS t(part, ord) WHERE trim(part) <> '') named
    ORDER BY lower(name), ord), ', ')
WHERE team ~* '(^|,)\s*liz\s*(,|$)';

-- Issue owners.
UPDATE client_records SET data = jsonb_set(data::jsonb, '{owner}', to_jsonb(regexp_replace(data::jsonb->>'owner', '\mLiz\M', 'Schatzy', 'g')))::text
WHERE data::jsonb->>'owner' ~ '\mLiz\M';

-- Open pipeline next steps assigned to her ("Liz to book …"). Mentions of other people named Liz are left alone.
UPDATE cards SET next_step = regexp_replace(next_step, '\mLiz to\M', 'Schatzy to', 'g'), version = version + 1
WHERE next_step ~ '\mLiz to\M';

-- Her login, if one exists: switch it off, end her sessions, and move anything she owned to Schatzy (or the first admin).
WITH leaver AS (SELECT id FROM users WHERE name ~* '^liz(\M|zie|abeth)' AND role <> 'admin'),
     heir AS (SELECT id FROM users WHERE enabled = 1 AND (name ~* '^(schatzy|michael schatzberg)' OR email ~* '^(schatzy|michael)')
              UNION ALL (SELECT id FROM users WHERE role = 'admin' AND enabled = 1 ORDER BY created_at, id LIMIT 1) LIMIT 1)
UPDATE clients SET owner_id = (SELECT id FROM heir) WHERE owner_id IN (SELECT id FROM leaver) AND EXISTS (SELECT 1 FROM heir);
WITH leaver AS (SELECT id FROM users WHERE name ~* '^liz(\M|zie|abeth)' AND role <> 'admin'),
     heir AS (SELECT id FROM users WHERE enabled = 1 AND (name ~* '^(schatzy|michael schatzberg)' OR email ~* '^(schatzy|michael)')
              UNION ALL (SELECT id FROM users WHERE role = 'admin' AND enabled = 1 ORDER BY created_at, id LIMIT 1) LIMIT 1)
UPDATE cards SET owner_id = (SELECT id FROM heir) WHERE owner_id IN (SELECT id FROM leaver) AND EXISTS (SELECT 1 FROM heir);
DELETE FROM client_members WHERE user_id IN (SELECT id FROM users WHERE name ~* '^liz(\M|zie|abeth)' AND role <> 'admin');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE name ~* '^liz(\M|zie|abeth)' AND role <> 'admin');
DELETE FROM setup_tokens WHERE user_id IN (SELECT id FROM users WHERE name ~* '^liz(\M|zie|abeth)' AND role <> 'admin');
UPDATE users SET enabled = 0 WHERE name ~* '^liz(\M|zie|abeth)' AND role <> 'admin';

-- Signed SCAs linked from her personal OneDrive will break when her account closes: open an issue on each client.
INSERT INTO client_records(id, client_id, kind, record_key, data, created_at, updated_at, updated_by)
SELECT md5('sca-move-' || c.id), c.id, 'issues', NULL,
  json_build_object('issue', 'The signed SCA link points to a former team member''s personal OneDrive. Move the signed SCA to the shared Solutions folder and update the SCA link before that account is closed.',
    'priority', 'High', 'status', 'Open', 'area', 'Contract', 'owner', 'Schatzy', 'raised', to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD'))::text,
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'System'
FROM clients c WHERE c.sca_url ~* 'liz' AND NOT EXISTS (SELECT 1 FROM client_records r WHERE r.id = md5('sca-move-' || c.id));
