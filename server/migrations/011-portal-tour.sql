-- Remember when a portal login finished (or skipped) the welcome tour, so it shows once per person.
ALTER TABLE users ADD COLUMN portal_tour_done_at TEXT;
