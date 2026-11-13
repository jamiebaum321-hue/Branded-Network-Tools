-- Mercosa signed its SCA (confirmed by Daniel, Nov 13, 2026).
UPDATE clients SET stage='current', deal_status='Active – Paying', agreement_status='Signed'
WHERE id IN (SELECT local_id FROM imported_records WHERE namespace='solutions-tracker' AND kind='clients' AND source_id='mercosa');
