-- Additive: queue membership is independent of apartment/publication/guest data.
CREATE TABLE IF NOT EXISTS uploads_gallery(
 id INTEGER PRIMARY KEY CHECK(id=1),apartments TEXT NOT NULL CHECK(json_valid(apartments) AND json_type(apartments)='array' AND json_array_length(apartments)<=1000),
 revision INTEGER NOT NULL,changed_by TEXT NOT NULL,changed_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO uploads_gallery VALUES(1,'[]',0,'migration',0);
CREATE TRIGGER IF NOT EXISTS uploads_added_audit AFTER UPDATE ON uploads_gallery BEGIN
 INSERT INTO activity_history(actor,action,resource,status,created)
 SELECT NEW.changed_by,'uploads.queue.add',value,200,NEW.changed_at FROM json_each(NEW.apartments)
 WHERE value NOT IN (SELECT value FROM json_each(OLD.apartments));
 INSERT INTO activity_history(actor,action,resource,status,created)
 SELECT NEW.changed_by,'uploads.queue.remove',value,200,NEW.changed_at FROM json_each(OLD.apartments)
 WHERE value NOT IN (SELECT value FROM json_each(NEW.apartments));
END;
