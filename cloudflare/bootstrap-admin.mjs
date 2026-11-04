import { emailPattern, firebaseUidPattern, normalizeUsername, usernamePattern } from './firebase-auth.mjs';

const [rawUsername, uid, email] = process.argv.slice(2);
const username = normalizeUsername(rawUsername);
if (!usernamePattern.test(username) || !uid || !firebaseUidPattern.test(uid) || !email || !emailPattern.test(email)) {
  throw new Error('Usage: node cloudflare/bootstrap-admin.mjs USERNAME FIREBASE_UID FIREBASE_EMAIL');
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
process.stdout.write(`INSERT INTO firebase_staff_accounts (username,firebase_uid,email,role)
SELECT ${quote(username)},${quote(uid)},${quote(email)},'administrator'
WHERE NOT EXISTS (SELECT 1 FROM firebase_staff_accounts);\n`);
