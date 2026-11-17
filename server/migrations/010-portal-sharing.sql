-- Client portal sharing: nothing is shared unless someone turns it on.
ALTER TABLE clients ADD COLUMN next_step_shared INTEGER NOT NULL DEFAULT 0 CHECK (next_step_shared IN (0, 1));
ALTER TABLE activity_log ADD COLUMN shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1));
ALTER TABLE cards ADD COLUMN portal_hidden INTEGER NOT NULL DEFAULT 0 CHECK (portal_hidden IN (0, 1));

-- A shared next step stops being shared the moment its wording changes, however it is edited
-- (account form, next-step form, approvals, tracker sync), so an internal edit never reaches the client.
CREATE FUNCTION unshare_changed_next_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.next_step IS DISTINCT FROM OLD.next_step AND NEW.next_step_shared = OLD.next_step_shared THEN
    NEW.next_step_shared := 0;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clients_unshare_next_step BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION unshare_changed_next_step();

-- Same for an activity entry whose text is edited after sharing.
CREATE FUNCTION unshare_changed_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text AND NEW.shared = OLD.shared THEN
    NEW.shared := 0;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_log_unshare BEFORE UPDATE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION unshare_changed_activity();
