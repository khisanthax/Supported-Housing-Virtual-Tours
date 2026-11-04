import { hashStaffPassword, normalizeUsername, usernamePattern } from './staff-password.mjs';

const args = process.argv.slice(2);
const username = normalizeUsername(args[0]);
if (args.length !== 1 || !usernamePattern.test(username) || process.stdin.isTTY) {
  throw new Error('Usage: securely pipe the password to node cloudflare/bootstrap-password-admin.mjs USERNAME');
}

const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > 258) throw new Error('Password exceeds 256 UTF-8 bytes.');
  chunks.push(chunk);
}
const input = Buffer.concat(chunks);
let password;
try {
  password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
} finally {
  input.fill(0);
  for (const chunk of chunks) chunk.fill(0);
}
if (password.endsWith('\r\n')) password = password.slice(0, -2);
else if (password.endsWith('\n')) password = password.slice(0, -1);

const verifier = hashStaffPassword(password);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
process.stdout.write(`INSERT INTO staff_accounts (username,password_verifier,role)
SELECT ${quote(username)},${quote(verifier)},'administrator'
WHERE NOT EXISTS (SELECT 1 FROM staff_accounts);\n`);
