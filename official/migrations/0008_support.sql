CREATE TABLE IF NOT EXISTS support_grants (
  id TEXT PRIMARY KEY,
  installation TEXT NOT NULL,
  creator TEXT NOT NULL,
  invite_digest TEXT UNIQUE NOT NULL,
  session_digest TEXT UNIQUE,
  permissions TEXT NOT NULL,
  apartments TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration IN (2,24,48,72)),
  created INTEGER NOT NULL,
  redeem_by INTEGER NOT NULL,
  activated INTEGER,
  expires INTEGER,
  revoked INTEGER,
  ended INTEGER,
  ended_by TEXT,
  requested INTEGER,
  decision TEXT CHECK(decision IN ('extension_approved','extension_denied')),
  decided INTEGER,
  decision_hours INTEGER,
  decider TEXT
);
CREATE INDEX IF NOT EXISTS support_expiry ON support_grants(installation,expires);
CREATE TABLE IF NOT EXISTS support_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id TEXT,
  installation TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS support_audit_installation ON support_audit(installation,seq);
CREATE TABLE IF NOT EXISTS support_rate (
  installation TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS support_created AFTER INSERT ON support_grants BEGIN
  INSERT INTO support_audit(grant_id,installation,event,actor,at,detail)
  VALUES(NEW.id,NEW.installation,'created',NEW.creator,NEW.created,
    json_object('permissions',json(NEW.permissions),'apartments',json(NEW.apartments),'hours',NEW.duration,'redeemBy',NEW.redeem_by));
END;
CREATE TRIGGER IF NOT EXISTS support_activated AFTER UPDATE OF activated ON support_grants
WHEN OLD.activated IS NULL AND NEW.activated IS NOT NULL BEGIN
  INSERT INTO support_audit(grant_id,installation,event,actor,at)
  VALUES(NEW.id,NEW.installation,'activated','support',NEW.activated);
END;
CREATE TRIGGER IF NOT EXISTS support_extension_requested AFTER UPDATE OF requested ON support_grants
WHEN OLD.requested IS NULL AND NEW.requested IS NOT NULL BEGIN
  INSERT INTO support_audit(grant_id,installation,event,actor,at)
  VALUES(NEW.id,NEW.installation,'extension_requested','support',NEW.requested);
END;
CREATE TRIGGER IF NOT EXISTS support_extension_decided AFTER UPDATE OF decided ON support_grants
WHEN OLD.decided IS NOT NEW.decided AND NEW.decided IS NOT NULL BEGIN
  INSERT INTO support_audit(grant_id,installation,event,actor,at,detail)
  VALUES(NEW.id,NEW.installation,NEW.decision,NEW.decider,NEW.decided,
    json_object('hours',NEW.decision_hours,'expires',NEW.expires));
END;
CREATE TRIGGER IF NOT EXISTS support_access_closed AFTER UPDATE OF ended,revoked ON support_grants
WHEN (OLD.ended IS NULL AND NEW.ended IS NOT NULL) OR (OLD.revoked IS NULL AND NEW.revoked IS NOT NULL) BEGIN
  INSERT INTO support_audit(grant_id,installation,event,actor,at)
  VALUES(NEW.id,NEW.installation,CASE WHEN NEW.revoked IS NOT NULL THEN 'revoked'
    WHEN NEW.ended_by='support' THEN 'ended' WHEN NEW.activated IS NULL THEN 'key_expired' ELSE 'expired' END,
    CASE WHEN NEW.revoked IS NOT NULL THEN NEW.decider ELSE coalesce(NEW.ended_by,'system') END,coalesce(NEW.revoked,NEW.ended));
END;

CREATE TRIGGER IF NOT EXISTS official_backup_support_grants_insert BEFORE INSERT ON support_grants
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_grants_update BEFORE UPDATE ON support_grants
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_grants_delete BEFORE DELETE ON support_grants
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_audit_insert BEFORE INSERT ON support_audit
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_audit_update BEFORE UPDATE ON support_audit
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_audit_delete BEFORE DELETE ON support_audit
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_rate_insert BEFORE INSERT ON support_rate
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_rate_update BEFORE UPDATE ON support_rate
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
CREATE TRIGGER IF NOT EXISTS official_backup_support_rate_delete BEFORE DELETE ON support_rate
WHEN EXISTS(SELECT 1 FROM official_restore WHERE source_digest LIKE 'backup:%') BEGIN SELECT RAISE(ABORT,'LT360_BACKUP'); END;
