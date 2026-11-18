-- Applied by an authorized infrastructure operator, never a public request.
CREATE TABLE IF NOT EXISTS agency_setup (
 id INTEGER PRIMARY KEY CHECK(id=1),
 installation TEXT NOT NULL,
 token_digest TEXT NOT NULL,
 expires INTEGER NOT NULL,
 completed INTEGER
);
CREATE TRIGGER IF NOT EXISTS agency_setup_close AFTER INSERT ON staff_accounts BEGIN
 UPDATE agency_setup SET completed=COALESCE(completed,CAST(strftime('%s','now') AS INTEGER)*1000), token_digest='' WHERE id=1;
END;
