-- Block in-flight application writes while an infrastructure backup captures D1 and KV.
CREATE TRIGGER IF NOT EXISTS official_backup_photos_insert
BEFORE INSERT ON photos WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;

-- The restored audit history already contains these events.
DROP TRIGGER IF EXISTS uac_insert_audit;
CREATE TRIGGER IF NOT EXISTS uac_insert_audit AFTER INSERT ON uac_policy
WHEN NOT EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'restore:%') BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,NEW.key,NULL,NEW.value,NEW.changed_at);
END;
DROP TRIGGER IF EXISTS uac_update_audit;
CREATE TRIGGER IF NOT EXISTS uac_update_audit AFTER UPDATE ON uac_policy
WHEN NOT EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'restore:%') BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,NEW.key,OLD.value,NEW.value,NEW.changed_at);
END;
DROP TRIGGER IF EXISTS gallery_insert_audit;
CREATE TRIGGER IF NOT EXISTS gallery_insert_audit AFTER INSERT ON client_gallery
WHEN NOT EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'restore:%') BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,'gallery:'||NEW.apartment,NULL,json_object('enabled',NEW.enabled,'published_revision',NEW.published_revision,'display_name',NEW.display_name,'description',NEW.description),NEW.changed_at);
END;
DROP TRIGGER IF EXISTS gallery_update_audit;
CREATE TRIGGER IF NOT EXISTS gallery_update_audit AFTER UPDATE ON client_gallery
WHEN NOT EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'restore:%') BEGIN
 INSERT INTO access_history(actor,target,previous,new_value,created) VALUES(NEW.changed_by,'gallery:'||NEW.apartment,json_object('enabled',OLD.enabled,'published_revision',OLD.published_revision,'display_name',OLD.display_name,'description',OLD.description),json_object('enabled',NEW.enabled,'published_revision',NEW.published_revision,'display_name',NEW.display_name,'description',NEW.description),NEW.changed_at);
END;
DROP TRIGGER IF EXISTS uploads_added_audit;
CREATE TRIGGER IF NOT EXISTS uploads_added_audit AFTER UPDATE ON uploads_gallery
WHEN NOT EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'restore:%') BEGIN
 INSERT INTO activity_history(actor,action,resource,status,created)
 SELECT NEW.changed_by,'uploads.queue.add',value,200,NEW.changed_at FROM json_each(NEW.apartments)
 WHERE value NOT IN (SELECT value FROM json_each(OLD.apartments));
 INSERT INTO activity_history(actor,action,resource,status,created)
 SELECT NEW.changed_by,'uploads.queue.remove',value,200,NEW.changed_at FROM json_each(OLD.apartments)
 WHERE value NOT IN (SELECT value FROM json_each(NEW.apartments));
END;
CREATE TRIGGER IF NOT EXISTS official_backup_photos_update
BEFORE UPDATE ON photos WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photos_delete
BEFORE DELETE ON photos WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_versions_insert
BEFORE INSERT ON versions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_versions_update
BEFORE UPDATE ON versions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_versions_delete
BEFORE DELETE ON versions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_shares_insert
BEFORE INSERT ON shares WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_shares_update
BEFORE UPDATE ON shares WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_shares_delete
BEFORE DELETE ON shares WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_permissions_insert
BEFORE INSERT ON permissions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_permissions_update
BEFORE UPDATE ON permissions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_permissions_delete
BEFORE DELETE ON permissions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_sessions_insert
BEFORE INSERT ON sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_sessions_update
BEFORE UPDATE ON sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_sessions_delete
BEFORE DELETE ON sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_attempts_insert
BEFORE INSERT ON attempts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_attempts_update
BEFORE UPDATE ON attempts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_attempts_delete
BEFORE DELETE ON attempts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_apartment_visibility_insert
BEFORE INSERT ON apartment_visibility WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_apartment_visibility_update
BEFORE UPDATE ON apartment_visibility WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_apartment_visibility_delete
BEFORE DELETE ON apartment_visibility WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photo_age_insert
BEFORE INSERT ON photo_age WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photo_age_update
BEFORE UPDATE ON photo_age WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photo_age_delete
BEFORE DELETE ON photo_age WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_firebase_staff_accounts_insert
BEFORE INSERT ON firebase_staff_accounts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_firebase_staff_accounts_update
BEFORE UPDATE ON firebase_staff_accounts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_firebase_staff_accounts_delete
BEFORE DELETE ON firebase_staff_accounts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_firebase_staff_sessions_insert
BEFORE INSERT ON firebase_staff_sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_firebase_staff_sessions_update
BEFORE UPDATE ON firebase_staff_sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_firebase_staff_sessions_delete
BEFORE DELETE ON firebase_staff_sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_accounts_insert
BEFORE INSERT ON staff_accounts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_accounts_update
BEFORE UPDATE ON staff_accounts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_accounts_delete
BEFORE DELETE ON staff_accounts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_sessions_insert
BEFORE INSERT ON staff_sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_sessions_update
BEFORE UPDATE ON staff_sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_sessions_delete
BEFORE DELETE ON staff_sessions WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_uac_policy_insert
BEFORE INSERT ON uac_policy WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_uac_policy_update
BEFORE UPDATE ON uac_policy WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_uac_policy_delete
BEFORE DELETE ON uac_policy WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_access_history_insert
BEFORE INSERT ON access_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_access_history_update
BEFORE UPDATE ON access_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_access_history_delete
BEFORE DELETE ON access_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_client_gallery_insert
BEFORE INSERT ON client_gallery WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_client_gallery_update
BEFORE UPDATE ON client_gallery WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_client_gallery_delete
BEFORE DELETE ON client_gallery WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photo_ownership_insert
BEFORE INSERT ON photo_ownership WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photo_ownership_update
BEFORE UPDATE ON photo_ownership WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_photo_ownership_delete
BEFORE DELETE ON photo_ownership WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_login_history_insert
BEFORE INSERT ON staff_login_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_login_history_update
BEFORE UPDATE ON staff_login_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_staff_login_history_delete
BEFORE DELETE ON staff_login_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_activity_history_insert
BEFORE INSERT ON activity_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_activity_history_update
BEFORE UPDATE ON activity_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_activity_history_delete
BEFORE DELETE ON activity_history WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_uploads_gallery_insert
BEFORE INSERT ON uploads_gallery WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_uploads_gallery_update
BEFORE UPDATE ON uploads_gallery WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_uploads_gallery_delete
BEFORE DELETE ON uploads_gallery WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_settings_insert
BEFORE INSERT ON diagnostic_settings WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_settings_update
BEFORE UPDATE ON diagnostic_settings WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_settings_delete
BEFORE DELETE ON diagnostic_settings WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_operations_insert
BEFORE INSERT ON diagnostic_operations WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_operations_update
BEFORE UPDATE ON diagnostic_operations WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_operations_delete
BEFORE DELETE ON diagnostic_operations WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_daily_insert
BEFORE INSERT ON diagnostic_daily WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_daily_update
BEFORE UPDATE ON diagnostic_daily WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_diagnostic_daily_delete
BEFORE DELETE ON diagnostic_daily WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_migration_receipts_insert
BEFORE INSERT ON migration_receipts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_migration_receipts_update
BEFORE UPDATE ON migration_receipts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_migration_receipts_delete
BEFORE DELETE ON migration_receipts WHEN EXISTS (SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%')
BEGIN SELECT RAISE(ABORT,'LT360_BACKUP_IN_PROGRESS'); END;
