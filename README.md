# Branded Network Tools

Branded Network Tools is the team's internal sales and delivery workspace for Solutions, Media and Capital. One company can have an independently owned engagement in each line. Open `/work` after signing in.

| Screen | Workflow |
| --- | --- |
| Solutions | Follow prospects through agreement, transfer signed terms to accounting, collect advisory intake, review relationship-backed introductions and send weekly client updates. |
| Media | Build campaign target lists, track the agency and advertiser, reconcile conversations, return to nurture leads, review Hospitality Hangout pitches and deliver signed sponsor packages. |
| Capital | Record fundraising mandates, signed monthly retainers, raise targets, capital actually raised and contingent fee terms. |
| Today | Open due follow-ups, drafts, newly logged replies and pending leads for the signed-in owner. |
| Pipeline | Browse To Contact, Reached Out, In Conversation and Closed. Drag cards between stages on desktop or use **Edit contact & stage** on a phone or keyboard. Review and edit drafts, open a prefilled message in your email app, and log activity. |
| Metrics | Filter stage counts, time in stage, overdue follow-ups, logged sends and logged replies by owner, client and date. |
| Suggested leads | Search by person or company and filter by client, review status, fit and source. Review the evidence and approve a lead into To Contact or dismiss it. |
| Clients | Share the client-scoped onboarding link, reopen submitted versions and export a selected response to PDF. |
| Admin | Invite admins and members, manage client access, issue Claude credentials, review the audit log, and preview and apply a JSON migration. |

The in-app bell covers introduction follow-ups, replies, stage changes and submissions. Today also lists due engagement actions and nurture reminders. A Microsoft 365 worker can collect Media activity, acknowledge podcast pitches and send accounting packets and staff-reviewed reports. Staff can record work manually and use their own Claude identity for research. Branded's private 7 a.m. briefing is a separate scheduled event in its Claude workspace. [Business workflows and activation](docs/WORKSPACES.md)

## Try the local demo

Install Node.js 24.15 or later in the Node 24 series and Python 3.11 or later. Install the PDF dependency and start the demo.

```sh
python -m pip install -r requirements.txt
npm run demo
```

Open the loopback address shown in the terminal. The sign-in form is prefilled for a fictional admin. The demo binds to `127.0.0.1` and its records reset on restart. Use the `PDF_PYTHON` environment variable to point to a specific Python executable when needed. On Unix, the default executable is `python3`.

## Configure production

1. Choose a host for one Node process and provision a private, persistent filesystem volume. The app initializes its SQLite database at `DATABASE_PATH`. The database and its WAL files must share the volume. Use a service account with access to that directory.
2. Install Node and Python as above. Install the Python dependency into the runtime that `PDF_PYTHON` points to. Set `PDF_FONT_PATH` to a TrueType font covering the languages used in intake responses if your host lacks a suitable default font.
3. Use [.env.example](.env.example) as the configuration template. Set `NODE_ENV=production`, the real HTTPS `APP_ORIGIN`, the absolute `DATABASE_PATH`, and a persistent, random `LINK_SECRET`. A command to generate the secret is shown below. Keep these settings in the service environment or an untracked `.env` with restricted access.
4. Terminate TLS at a reverse proxy, preserve the public `Host` header and route to the configured `HOST` and `PORT`. Allow 7 MiB request bodies for base64 file uploads. Exclude authorization headers, cookies, signed file URLs and token-bearing onboarding and setup URLs from proxy logs. Start the service with `npm start` and check `/api/health`.
5. Run the bootstrap command below once. Open the one-time setup link to set the first admin’s password. From **Admin → Accounts**, invite another admin and the partner managers as members. Share each one-time link privately. Admins can also issue a password reset link. From **Clients**, set the client owner and grant access to the teammates who manage that account.
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

The integration tests use temporary loopback servers and isolated SQLite data. They cover version 1 upgrades, account and workspace isolation, contract signing, accounting, intake and PDF, campaign routing, mailbox replay, introductions, weekly reporting and Claude permissions. CI also runs `npm run test:browser` through a complete desktop and mobile pilot using Playwright and Chrome. For a local browser test, make `playwright-core` available to Node and set `BNT_SMOKE_CHROMIUM` to the Chrome executable.
