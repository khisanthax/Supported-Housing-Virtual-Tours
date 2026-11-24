# Set up your LevelTwo360 pilot

LevelTwo360 lets your team make apartment tours and share them with guests. Your agency owns the site, files, and accounts. Start with made-up names and sample photos.

**Pilot contact** Ask your pilot lead for the name and work email of your support contact before you start.

## Get ready

- Use your agency’s **Cloudflare** account. Cloudflare runs your site.
- Use your agency’s **GitHub** group. GitHub keeps the files that run your site. Sign in with your own work login.
- Ask the people who manage both accounts to help. Your GitHub owner may need to let Cloudflare use the new private project.
- Pick a site admin and a person who can restore the site from a backup. Your pilot lead can help you plan this.
- Use **Workers Free** for this test. Cloudflare sets usage limits. Stop and ask your pilot lead if a screen asks you to pay or change plans.

## Put your site online

1. Open [Deploy LevelTwo360](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fkhisanthax%2Fleveltwo360-cloudflare-template). Pick your agency’s Cloudflare account and GitHub group.
2. Give Cloudflare access only to the GitHub projects your agency has approved. Check that the new project is private and belongs to your agency.
3. Pick a new site name and new storage. In **LT360_INSTALL_KEY**, enter a random key made by your password manager. Use 24 to 128 letters, numbers, or symbols with no spaces. Save it for the next step. Leave the build and deploy settings as they are.
4. Click **Deploy** once. When the build says it is done, click **Visit** or open the site address that ends in **workers.dev**.
5. On your new site, enter the temporary key. Pick an Administrator name and a new password. Use at least 15 characters for the password. The key expires one hour after Cloudflare sets up the database. It also stops working as soon as the Administrator is made.
6. Sign in with your new account. Save the site and GitHub links in your agency’s records. Keep the password in your agency’s password manager.

## Give people the right access

- **Administrators** run the site. Open **Staff Accounts** to add a staff member. Open **User Access Control → Apartment Access** to pick which homes they can see. Use a Staff account for daily work when full access is not needed.
- **Staff** can work only on the homes and tasks they have been given. Sign in as the test staff member and check that an unassigned home stays hidden.
- **Guests** can see a tour you publish and share with them. Set an end date for the link. Send the link and the secret words in two ways if you can. In **Guest Links**, revoke the test link and check that a guest who already opened it loses access.

## Keep a safe copy and plan for changes

- To save one apartment, choose **Export Backup** in the editor. Pick a new backup password and keep it apart from the file. To test it, use **Backups and storage** and import it as a **New apartment**. A new copy starts as a private draft.
- For a full site backup, ask your recovery operator to use the [corrected backup tool](PILOT-MAINTENANCE.md). The tool in the public Deploy copy is too old for this pilot. Keep the full backup and the key that opens it in two safe places.
- Ask your site owner to make a full backup before an update. Test the change on a test site first. If the new version fails, the site owner can switch back to the last good version. If data was lost or changed, the recovery operator may need to restore it to a new site.

## Get help

| What you see | What to do |
| --- | --- |
| You cannot find your agency in GitHub | Ask your GitHub owner to check the Cloudflare app’s access. |
| The build fails | Ask your Cloudflare owner to check **Builds**. Retry the same site and storage after they fix the error. |
| You lost the setup key or it ran out | Open **I lost my key or setup expired** on the setup page. Ask your Cloudflare owner to help. |
| A new tour will not open | Wait about a minute. Try it as a guest in another browser window. |
| The site says it is under maintenance | Ask your recovery operator what is running. Leave the job in place until they check it. |

If you get stuck, tell your pilot contact which step failed, when it happened, and what the screen said. Keep passwords, keys, guest links, and photos out of the message. Your pilot uses a human support contact. It needs no Help Hub or Codex.

[Run the test with your team](PILOT.md)
