-- Additive migration. Apply only after complete route enforcement acceptance.
CREATE TABLE IF NOT EXISTS uac_policy(
 key TEXT PRIMARY KEY,value TEXT NOT NULL CHECK(json_valid(value)),revision INTEGER NOT NULL DEFAULT 1,
 changed_by TEXT NOT NULL,changed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,target TEXT NOT NULL,
 previous TEXT,new_value TEXT,created INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS uac_insert_audit AFTER INSERT ON uac_policy BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,NEW.key,NULL,NEW.value,NEW.changed_at);
END;
CREATE TRIGGER IF NOT EXISTS uac_update_audit AFTER UPDATE ON uac_policy BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,NEW.key,OLD.value,NEW.value,NEW.changed_at);
END;
CREATE TABLE IF NOT EXISTS client_gallery(
 apartment TEXT PRIMARY KEY,published_revision INTEGER NOT NULL,display_name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 changed_by TEXT NOT NULL,changed_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1
);
CREATE TRIGGER IF NOT EXISTS gallery_insert_audit AFTER INSERT ON client_gallery BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,'gallery:'||NEW.apartment,NULL,json_object('enabled',NEW.enabled,'published_revision',NEW.published_revision,'display_name',NEW.display_name,'description',NEW.description),NEW.changed_at);
END;
CREATE TRIGGER IF NOT EXISTS gallery_update_audit AFTER UPDATE ON client_gallery BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,'gallery:'||NEW.apartment,json_object('enabled',OLD.enabled,'published_revision',OLD.published_revision,'display_name',OLD.display_name,'description',OLD.description),json_object('enabled',NEW.enabled,'published_revision',NEW.published_revision,'display_name',NEW.display_name,'description',NEW.description),NEW.changed_at);
END;
CREATE TABLE IF NOT EXISTS photo_ownership(photo TEXT PRIMARY KEY,username TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff_login_history(username TEXT PRIMARY KEY,last_login INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS preserve_last_administrator BEFORE UPDATE OF role,disabled ON staff_accounts
 WHEN OLD.role='administrator' AND OLD.disabled=0 AND (NEW.role<>'administrator' OR NEW.disabled<>0)
 AND NOT EXISTS(SELECT 1 FROM staff_accounts WHERE username<>OLD.username AND role='administrator' AND disabled=0)
 BEGIN SELECT RAISE(ABORT,'Last active Administrator must be preserved'); END;
CREATE TRIGGER IF NOT EXISTS preserve_last_administrator_delete BEFORE DELETE ON staff_accounts
 WHEN OLD.role='administrator' AND OLD.disabled=0
 AND NOT EXISTS(SELECT 1 FROM staff_accounts WHERE username<>OLD.username AND role='administrator' AND disabled=0)
 BEGIN SELECT RAISE(ABORT,'Last active Administrator must be preserved'); END;

CREATE TABLE IF NOT EXISTS activity_history(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,resource TEXT,status INTEGER NOT NULL,created INTEGER NOT NULL);
