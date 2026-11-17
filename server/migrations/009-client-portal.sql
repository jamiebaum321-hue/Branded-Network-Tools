-- Client portal: a third kind of login, tied to exactly one client company.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member', 'client'));
ALTER TABLE users ADD COLUMN portal_client_id TEXT REFERENCES clients(id);
ALTER TABLE users ADD COLUMN last_sign_in_at TEXT;
ALTER TABLE users ADD CONSTRAINT users_portal_client CHECK ((role = 'client') = (portal_client_id IS NOT NULL));
CREATE INDEX users_portal_client ON users(portal_client_id) WHERE portal_client_id IS NOT NULL;
