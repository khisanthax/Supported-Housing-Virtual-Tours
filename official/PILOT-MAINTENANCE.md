# Back up and restore the pilot site

For the agency recovery operator. The [short setup packet](AGENCY-PILOT.md) covers the steps most staff need.

## Get the right tool

Use Git and Node.js 24 on a computer your agency manages. Git gets the exact files. Node.js runs the tool.

Open a terminal in an empty work folder. Run these commands. Keep this folder apart from the GitHub project that updates your site.

```text
git clone --no-checkout https://github.com/khisanthax/Supported-Housing-Virtual-Tours.git leveltwo360-pilot-maintenance
cd leveltwo360-pilot-maintenance
git checkout --detach d5de70706e31385e13b655334f729eb5e0694149
git rev-parse HEAD
npm ci
```

Check that Git prints `d5de70706e31385e13b655334f729eb5e0694149`. Stop if it prints a different value or any step fails. Run the commands below from this folder. **The backup tool in the public Deploy copy is older. Do not use it.**

## Check which site you will work on

1. Tell staff when the site will be closed for a backup. Ask the Cloudflare owner to pause builds, updates, and rollbacks until the job ends.
2. Ask the owner for a short-lived Cloudflare API token. A token is a key that lets the tool use Cloudflare. Limit it to the intended account. It needs to read Worker deployments, versions, and the Workers subdomain. It needs edit access to D1 (the database) and Workers KV (the photo store).
3. Set `LT360_CLOUDFLARE_TOKEN` in this terminal through your agency’s approved secret tool or the hidden prompt below. Paste the token only at that prompt. Keep it out of commands, files, chat, and screenshots.

PowerShell 7.1 or later

```powershell
$env:LT360_CLOUDFLARE_TOKEN = Read-Host -MaskInput "Cloudflare token"
```

Bash

```bash
read -r -s -p "Cloudflare token: " LT360_CLOUDFLARE_TOKEN
printf '\n'
export LT360_CLOUDFLARE_TOKEN
```

Run the check below. Replace words in capitals with your site details or file paths. Use quotes around paths that contain spaces.

```text
npm run agency:maintenance -- inspect ACCOUNT_ID WORKER_NAME
```

Compare the website and the `version`, `database`, and `namespace` values with your Cloudflare records. In **Deployments**, check that the expected version gets 100% of visits. If any value differs or the tool reports split traffic, stop and ask the Cloudflare owner to check.

Copy `targetReceipt` from that result. It tells the tool which version and storage you just checked. Set it in the same terminal. Keep the inspect result in your agency’s private records.

PowerShell 7.1 or later

```powershell
$env:LT360_MAINTENANCE_TARGET = Read-Host "Target receipt from inspect"
```

Bash

```bash
read -r -p "Target receipt from inspect: " LT360_MAINTENANCE_TARGET
export LT360_MAINTENANCE_TARGET
```

## Make a full backup

1. Use new file paths in safe folders outside the code folder. Make a pair of keys if your agency has yet to set one up. The public key locks the backup. The private key opens it. Keep the private key apart from the backup file.
2. Use the receipt for the site you are backing up. Run the backup. Staff and guests may see a short pause.
3. Check that the tool reports `restoreVerified: true` and `photoInventoryVerified: true`. Save the `sha256` value in a separate private record with the date, source revision, and Worker and storage details. The value helps you spot a changed file. Keep a copy of the agency’s source files and settings too.

```text
npm run agency:maintenance -- keys PRIVATE_KEY_FILE PUBLIC_KEY_FILE
npm run agency:maintenance -- backup ACCOUNT_ID WORKER_NAME BACKUP_FILE PUBLIC_KEY_FILE
```

## Restore to a new site

1. Use the same reviewed app version to set up a new test site. Give it its own Worker, database, and photo store. Leave the Administrator setup screen alone. The restore brings back the old staff accounts.
2. Run `inspect` for the new site. Check that `initialized` is `false` on a fresh site. Compare its details with your Cloudflare records. Replace the source receipt with this new site’s receipt.
3. Run the command below. Use the `sha256` you saved when you made the backup.
4. Sign in to the new site. Check staff access, the draft, and its photos. Check guest access from the new site and revoke the test link when done. Keep the source site and its files safe.

```text
npm run agency:maintenance -- restore TARGET_ACCOUNT_ID TARGET_WORKER_NAME BACKUP_FILE PRIVATE_KEY_FILE TRUSTED_SHA256
```

If a restore stops, keep the site closed. Check that the old job has ended. Use the same backup, code version, and storage. Inspect the site again. If a lock remains or the tool says the target changed, ask the pilot contact before you try again. See the [full recovery steps](README.md#backups-and-recovery) for lock help. A backup file without a verified result is not ready to use.

After the job, clear the token and receipt from the terminal. Ask the Cloudflare owner to revoke the token.

PowerShell 7.1 or later

```powershell
Remove-Item Env:LT360_CLOUDFLARE_TOKEN, Env:LT360_MAINTENANCE_TARGET
```

Bash

```bash
unset LT360_CLOUDFLARE_TOKEN LT360_MAINTENANCE_TARGET
```
