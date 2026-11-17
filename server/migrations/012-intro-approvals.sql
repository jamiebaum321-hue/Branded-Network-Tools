-- Approvals can propose an intro update (status and next step on one pipeline card).
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (kind IN ('email_draft','record_update','note','intro_update'));
