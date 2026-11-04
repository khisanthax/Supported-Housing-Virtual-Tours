CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, bytes INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS photo_budget BEFORE INSERT ON photos BEGIN
  SELECT CASE WHEN NEW.bytes + COALESCE((SELECT SUM(bytes) FROM photos),0) > 400000000
    THEN RAISE(ABORT,'photo budget exceeded') END;
END;
CREATE TABLE IF NOT EXISTS versions(
  apartment TEXT NOT NULL, seq INTEGER NOT NULL, title TEXT NOT NULL, manifest TEXT NOT NULL,
  photos TEXT NOT NULL, available INTEGER NOT NULL, PRIMARY KEY(apartment,seq)
);
CREATE INDEX IF NOT EXISTS versions_available ON versions(apartment,available,seq);
CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
  verifier TEXT NOT NULL, expires INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1, revoked INTEGER);
CREATE TABLE IF NOT EXISTS permissions(share TEXT NOT NULL REFERENCES shares(id), apartment TEXT NOT NULL, PRIMARY KEY(share,apartment));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL,
  share TEXT REFERENCES shares(id), revision INTEGER);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS apartment_visibility(apartment TEXT PRIMARY KEY, state INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS photo_age(id TEXT PRIMARY KEY, created INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS firebase_staff_accounts(
  username TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('administrator','editor')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS firebase_staff_sessions(
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES firebase_staff_accounts(username),
  revision INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS firebase_staff_sessions_expiry ON firebase_staff_sessions(expires);
CREATE INDEX IF NOT EXISTS firebase_staff_sessions_account ON firebase_staff_sessions(username);
