# First agency test checklist

Use your agency’s own test site, with made-up names and sample photos. Use [the setup packet](AGENCY-PILOT.md) and ask your pilot contact for help. Mark each row **Pass** or **Fail** in your private notes. If a row fails, stop and share the issue with your pilot contact. Test it again after it is fixed.

| Step | Pass if… | If it fails |
| --- | --- | --- |
| 1. Set up the site | Your agency owns the Cloudflare site and the private GitHub project. **Visit** opens setup. Your test Administrator can sign in. The used setup key cannot make a second account. | Check the accounts and site address. Use the same site and storage if you retry a failed build. |
| 2. Test staff limits | Make one sample home and one empty test draft. Give a Staff account access to the sample home only. Staff can see the sample, cannot open the other draft, and cannot manage staff accounts. | Ask the Administrator to review the role and the saved apartment list. Check again while signed in as Staff. |
| 3. Share and revoke | Publish the sample tour. In a private browser window, open the guest link with its secret words and check the photos. Revoke the link. Reload in that window. Then close all private windows and try again. Both tests must fail to open the tour. | Check the link, publication, and revoke status. Wait about a minute after first publishing before testing playback. |
| 4. Make a full backup | Your recovery operator uses the [corrected tool](PILOT-MAINTENANCE.md). The tool verifies the backup. Your agency can find the file, its check value, and its separate key. | Keep the file out of use if the tool did not verify it. Check the site, storage, and access with your operator. |
| 5. Restore to a fresh site | Restore to an agency-owned test site with its own storage and no Administrator yet. A restored admin can sign in. Staff limits, the sample tour, and its photos match the source. | Keep the new site closed. Ask the recovery operator to check the backup, key, app version, and storage. Keep the source site safe. |
| 6. Test an update | The owner makes a verified backup, records the old version, and applies a reviewed change on the test site. Staff can sign in. The sample, photos, and access rules still work. | Stop before any wider use. Check the build and the live version. |
| 7. Test a rollback | The owner puts the last good version back in service. The site shows the expected version, and the same sign-in, draft, photos, and rules still work. | Wait up to five minutes for the app to switch. If data changed, ask the operator about a fresh restore. Moving back to old code does not move the database back. |
| 8. Close out the test | Test guest links are revoked on both sites. The agency keeps its notes and recovery files in safe places. | Finish cleanup with the agency. Keep real homes and photos out of both test sites. |

Record the date, which steps passed, and who checked them. Keep passwords, guest links, backup files, keys, and private site details in agency-approved storage. Have your pilot lead review your results before any real content is added.

## What has already been tested

LevelTwo360 passed a Workers Free test with made-up data. The tests covered setup, staff limits, guest viewing and revoke, backup and restore, updates, and rollback. The corrected backup tool also made and checked new backups on two hosted test sites. The updated tool was tested locally with fresh restore sites. Your team still needs to run its own test. Workers Paid tests are on hold. The Help Hub is not needed.

[Owner approval checklist](PILOT-APPROVAL.md)
