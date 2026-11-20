CREATE TABLE IF NOT EXISTS app_migrations(version INTEGER PRIMARY KEY,applied INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS diagnostic_settings(id INTEGER PRIMARY KEY CHECK(id=1),level TEXT NOT NULL CHECK(level IN ('off','error','normal','detail')),days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 30),max_rows INTEGER NOT NULL CHECK(max_rows BETWEEN 100 AND 10000));
INSERT OR IGNORE INTO diagnostic_settings VALUES(1,'normal',7,2000);
CREATE TABLE IF NOT EXISTS diagnostic_operations(id INTEGER PRIMARY KEY AUTOINCREMENT,operation TEXT NOT NULL,span TEXT NOT NULL,parent TEXT,actor TEXT NOT NULL,apartment TEXT,category TEXT NOT NULL,severity TEXT NOT NULL,code TEXT NOT NULL,stage TEXT NOT NULL,created INTEGER NOT NULL,duration REAL NOT NULL,version TEXT NOT NULL,build TEXT NOT NULL,deployment TEXT NOT NULL,source TEXT NOT NULL,saved TEXT NOT NULL,retry INTEGER NOT NULL,events TEXT NOT NULL,audit_id INTEGER);
CREATE INDEX IF NOT EXISTS diagnostic_trace ON diagnostic_operations(operation,id);
CREATE INDEX IF NOT EXISTS diagnostic_time ON diagnostic_operations(created);
CREATE TABLE IF NOT EXISTS diagnostic_daily(day INTEGER PRIMARY KEY,count INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS diagnostic_daily_limit BEFORE INSERT ON diagnostic_operations WHEN COALESCE((SELECT count FROM diagnostic_daily WHERE day=NEW.created-NEW.created%86400000),0)>=2000 BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS diagnostic_retention AFTER INSERT ON diagnostic_operations BEGIN
 INSERT INTO diagnostic_daily VALUES(NEW.created-NEW.created%86400000,1) ON CONFLICT(day) DO UPDATE SET count=count+1;
 DELETE FROM diagnostic_daily WHERE day<NEW.created-32*86400000;
 DELETE FROM diagnostic_operations WHERE id IN (SELECT id FROM diagnostic_operations WHERE created < NEW.created-(SELECT days FROM diagnostic_settings WHERE id=1)*86400000 OR id <= NEW.id-(SELECT max_rows FROM diagnostic_settings WHERE id=1) ORDER BY id LIMIT 100);
END;
CREATE TABLE IF NOT EXISTS migration_receipts(username TEXT NOT NULL,request_key TEXT NOT NULL,apartment TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(username,request_key));
INSERT OR IGNORE INTO app_migrations VALUES(4,CAST(strftime('%s','now') AS INTEGER)*1000);
