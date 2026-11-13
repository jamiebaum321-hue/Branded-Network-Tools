-- Corrections from the Solutions tracker files (Excel tracker 10/20, Oct 28 agenda, billing records).
-- Applies only to rows created by the 'solutions-tracker' import; a database without them is unchanged.
-- Sona: SCA signed by both parties Nov 2, 2026; invoiced Nov 9.
UPDATE clients SET stage='current', deal_status='Active – Paying', agreement_status='Signed',
  sca_signed=coalesce(sca_signed,'2026-11-02'), contract_start=coalesce(contract_start,'2026-11-02')
WHERE id IN (SELECT local_id FROM imported_records WHERE namespace='solutions-tracker' AND kind='clients' AND source_id='sona');

-- Foodbuy: Branded is making intros and invoiced $12,500 on Oct 23; Foodbuy has not countersigned the SCA.
UPDATE clients SET stage='current', deal_status='Active – Agreement Pending', agreement_status='Sent for Signature'
WHERE id IN (SELECT local_id FROM imported_records WHERE namespace='solutions-tracker' AND kind='clients' AND source_id='foodbuy');

-- Not Solutions clients in the Excel tracker, no introductions made: track them as prospects.
UPDATE clients SET stage='pipeline'
WHERE id IN (SELECT local_id FROM imported_records WHERE namespace='solutions-tracker' AND kind='clients'
  AND source_id IN ('fishman','david-energy','harmonized'));
