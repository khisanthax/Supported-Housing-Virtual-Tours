-- Anchor enrollment to provisioning. Visits, retries and deployments cannot extend it.
CREATE TABLE IF NOT EXISTS official_setup_window (
  id INTEGER PRIMARY KEY CHECK(id=1),
  expires INTEGER NOT NULL
);
INSERT OR IGNORE INTO official_setup_window(id,expires) VALUES(1,(unixepoch()+3600)*1000);
