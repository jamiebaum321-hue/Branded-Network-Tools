-- Solutions tracker account fields: every client carries a relationship stage and its agreement terms.
ALTER TABLE clients
  ADD COLUMN stage TEXT NOT NULL DEFAULT 'current' CHECK (stage IN ('current','referral','pipeline','passed')),
  ADD COLUMN deal_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN agreement_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN monthly_fee DOUBLE PRECISION CHECK (monthly_fee IS NULL OR monthly_fee >= 0),
  ADD COLUMN term_months INTEGER CHECK (term_months IS NULL OR term_months BETWEEN 0 AND 600),
  ADD COLUMN contract_start TEXT,
  ADD COLUMN contract_end TEXT,
  ADD COLUMN renewal_terms TEXT NOT NULL DEFAULT '',
  ADD COLUMN sca_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN sca_signed TEXT,
  ADD COLUMN referral_y1 DOUBLE PRECISION,
  ADD COLUMN referral_y2 DOUBLE PRECISION,
  ADD COLUMN referral_y3 DOUBLE PRECISION,
  ADD COLUMN website TEXT NOT NULL DEFAULT '',
  ADD COLUMN team TEXT NOT NULL DEFAULT '',
  ADD COLUMN next_step TEXT NOT NULL DEFAULT '',
  ADD COLUMN next_due TEXT,
  ADD COLUMN next_owner TEXT NOT NULL DEFAULT '',
  ADD COLUMN contacts TEXT NOT NULL DEFAULT '[]' CHECK (contacts::jsonb IS NOT NULL),
  ADD COLUMN about TEXT NOT NULL DEFAULT '',
  ADD COLUMN wants TEXT NOT NULL DEFAULT '',
  ADD COLUMN success TEXT NOT NULL DEFAULT '',
  ADD COLUMN latest TEXT NOT NULL DEFAULT '',
  ADD COLUMN updated_at TEXT;
CREATE INDEX clients_contract_end ON clients(contract_end) WHERE contract_end IS NOT NULL;
CREATE INDEX clients_next_due ON clients(next_due) WHERE next_step <> '';

-- Introduction detail carried over from the tracker.
ALTER TABLE cards
  ADD COLUMN intro_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN deal_value DOUBLE PRECISION CHECK (deal_value IS NULL OR deal_value >= 0),
  ADD COLUMN introduced_by TEXT NOT NULL DEFAULT '';
