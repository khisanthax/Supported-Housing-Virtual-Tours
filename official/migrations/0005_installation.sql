-- The first account and this installation record are created in one D1 batch.
CREATE TABLE IF NOT EXISTS official_installation (
  id INTEGER PRIMARY KEY CHECK(id=1),
  installation_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  guest_key TEXT NOT NULL,
  created INTEGER NOT NULL,
  restored_from TEXT
);
CREATE TABLE IF NOT EXISTS official_restore (
  id INTEGER PRIMARY KEY CHECK(id=1),
  source_digest TEXT NOT NULL,
  owner TEXT
);
CREATE TRIGGER IF NOT EXISTS official_finish_restore AFTER INSERT ON official_installation
WHEN NEW.restored_from IS NOT NULL
BEGIN DELETE FROM official_restore WHERE source_digest='restore:' || NEW.restored_from; END;
