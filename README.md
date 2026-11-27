# Branded Network Tools

Branded Network Tools manages advisory sales and delivery for Branded Hospitality Solutions. Sign in, then choose a workspace beneath Branded Network. Media and Capital currently show an under-construction page.

| Screen | Workflow |
| --- | --- |
| Pipelines | Move opportunities from Outreach to Signed. Admins can add or remove stages. Won and Lost use total contract value, or the fee plus the retainer over the recorded term. MRR totals active signed retainers. ARR equals MRR multiplied by 12. Signing opens the client record and queues the accounting handoff. |
| Project management | Open Onboarding, Weekly report, Introductions or Client follow-ups, or create a project with its own stages, schedule and clients. Track completed milestones as a percentage and export progress, dates and notes to CSV. |
| Clients | Start with intake and uploaded files. Add a note or connection beside the client name. Filter the introduction map by relationship health or date. Notes & activity includes submissions, changes between versions and recorded work. |
| Settings | Invite admins and team members, manage accounts and workspace access, and review mail delivery, Claude access, imports and audit history. |
| My profile | From the account menu, edit your name, job title, phone, bio, notification preference or password. |

Staff can record work manually or work from their own Claude identity. Branded’s 7 a.m. briefing lives in its Claude workspace. [Business workflows and activation](docs/WORKSPACES.md)

## Try the local demo

Install Node.js 24.15 or later in the Node 24 series and Python 3.11 or later. Install the PDF and Excel export dependencies and start the demo.

```sh
python -m pip install -r requirements.txt
npm run demo
```

Open the loopback address shown in the terminal. The sign-in form is prefilled for a fictional admin. The demo binds to `127.0.0.1` and its records reset on restart. Use the `PDF_PYTHON` environment variable to point to a specific Python executable when needed. On Unix, the default executable is `python3`.

## Configure production

1. Choose a host for one Node process and provision a private, persistent filesystem volume. The app initializes its SQLite database at `DATABASE_PATH`. The database and its WAL files must share the volume. Use a service account with access to that directory.
2. Install Node and Python as above. Install the Python requirements into the runtime that `PDF_PYTHON` points to. Set `PDF_FONT_PATH` to a TrueType font covering the languages used in intake responses and weekly updates if your host lacks a suitable default font.
3. Use [.env.example](.env.example) as the configuration template. Set `NODE_ENV=production`, the real HTTPS `APP_ORIGIN`, the absolute `DATABASE_PATH`, and a persistent, random `LINK_SECRET`. A command to generate the secret is shown below. Keep these settings in the service environment or an untracked `.env` with restricted access.
4. Terminate TLS at a reverse proxy, preserve the public `Host` header and route to the configured `HOST` and `PORT`. Allow 34 MiB request bodies for base64 file uploads. Exclude authorization headers, cookies, signed file URLs and token-bearing onboarding and setup URLs from proxy logs. Start the service with `npm start` and check `/api/health`.
5. Run the bootstrap command below once. Open the one-time setup link to set the first admin’s password. From **Settings → Team**, invite another admin and the partner managers as members. Share each one-time link privately. Admins can also issue a password reset link. From **Clients**, set the client owner and grant access to the teammates who manage that account.
6. For the existing records, review [the import format](docs/IMPORT.md), load the team’s JSON and reconcile the preview counts. In **Admin → Accounts**, turn on **Receive onboarding alerts** for the designated team members with client access.
7. Assign business lines and engagement owners through **Admin → Workspace operations**. Configure the production mailboxes and staff identities. Verify signing, one submission, one matched thread and a reviewed report using designated test recipients. [Microsoft 365 and go-live checks](docs/WORKSPACES.md) · [Claude access](docs/MCP.md)

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run admin:create -- "First Admin" admin@example.com
npm start
```

Admins manage accounts, clients, job access and the audit log. Members work in their assigned clients. Staff activity records the named user. The audit log also records account changes, sign-ins, card and lead actions, intake views and exports, imports, and MCP activity. Claude job writes carry the `claude` actor and its credential ID.

Run `npm run db:backup -- /path/to/new-backup.sqlite` for an online SQLite backup. Schedule protected, off-host backups and test restoration on a separate volume. Retain the configured `LINK_SECRET` for existing intake links. For restore, stop the app and restore the backup as the configured database on a clean volume before starting it. This deployment model uses one writable Node instance with persistent local storage.

## Verify

```sh
npm test
```

The integration tests use temporary loopback servers and isolated SQLite data. They cover version 1 and 2 upgrades, staff profiles, invitation delivery, project milestones, client map and roster imports, account and workspace isolation, contract signing, accounting, intake and PDF, campaign routing, mailbox replay, introductions, weekly reporting and Claude permissions. CI also runs `npm run test:browser` through a complete desktop and mobile pilot using Playwright and Chrome. For a local browser test, make `playwright-core` available to Node and set `BNT_SMOKE_CHROMIUM` to the Chrome executable.
