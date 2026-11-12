# Branded Network Tools

A workspace for the partner manager. It follows each company from first conversation to signed client, onboards them, keeps the people and companies that fit their ideal customer profile on their profile, tracks every introduction, and produces a monthly report of the work done for them.

| Screen | What it is for |
| --- | --- |
| Today | What needs you now: client next steps that are due, signed clients to onboard, matches to review, follow-ups, drafts and new replies. |
| Opportunities | The pre-purchase board: Prospect, Discovery, Proposal, Contract, Won. Drag a card between stages or switch to the list. Each card shows monthly value, next step and due date. |
| Clients | The post-purchase board: Onboarding, ICP matching, Delivering. |
| Client profile | One page per company with five tabs. **Overview** shows the journey, the next action, contact details and a timeline of stage changes and notes. **Profile** is the onboarding answers. **Matches** lists the companies and people who fit, to approve or dismiss. **Introductions** lists outreach in progress. **Monthly report** is the record of work done. |
| Introductions | The outreach board for approved matches: To Contact, Reached Out, In Conversation, Closed. Review drafts, open a prefilled message in your email app, and log activity. |
| Matches | Every match across clients, with fit, score, source and evidence. |
| Reports | One row per active client for the chosen month, with a PDF export. |
| Admin | Team accounts, Claude access, the JSON import and the audit log. |

## How a client moves through it

1. **Add an opportunity.** It starts as a Prospect. Move it through Discovery, Proposal and Contract as the deal progresses.
2. **Mark it won, then choose Start onboarding.** This creates a private link to the onboarding form. Send it to the client. Their answers save as they go.
3. **The client submits the form.** Their answers become the client’s profile, their contact details fill in, the stage moves to ICP matching, and the team is alerted. A manager can also edit the profile; each change is kept as a new version.
4. **Find matches with Claude.** The Matches tab gives a ready-made prompt. Claude reads the profile through this app’s connector, searches your HubSpot, email and Teams, and saves the companies and people who fit onto the client’s profile.
5. **Approve or dismiss each match.** Approving one creates an introduction card and moves the client to Delivering.
6. **Report each month.** Log introductions, meetings, social posts, podcast and video, newsletters, emails, events and press, with their numbers. Emails, introductions and conversations already recorded on introduction cards are included automatically. Write the summary and export the PDF.

The onboarding form is defined in [public/intake-fields.mjs](public/intake-fields.mjs). Stages and report sections are defined in [public/lifecycle.mjs](public/lifecycle.mjs). Colors, type and spacing are tokens at the top of [public/styles.css](public/styles.css).

Managers send outreach from their own email app. The team’s Claude job owns mailbox polling, discovery and notification email, and exchanges state with the app over MCP. See [Claude and MCP](docs/MCP.md).

## Try the local demo

Install Node.js 24.15 or later in the Node 24 series and Python 3.11 or later. Install the PDF dependency and start the demo.

```sh
python -m pip install -r requirements.txt
npm run demo
```

Open the loopback address shown in the terminal. The sign-in form is prefilled for a fictional admin. The demo binds to `127.0.0.1` and its records reset on restart. Use the `PDF_PYTHON` environment variable to point to a specific Python executable when needed. On Unix, the default executable is `python3`.

## Configure production

The app is one long-running Node process that keeps its data in a SQLite file. It needs a host with a persistent disk, such as a virtual machine or a container with a mounted volume. It does not run on serverless or edge platforms that discard the filesystem between requests.

1. Choose a host for one Node process and provision a private, persistent filesystem volume. The app initializes its SQLite database at `DATABASE_PATH` and upgrades it on start. The database and its WAL files must share the volume. Use a service account with access to that directory.
2. Install Node and Python as above. Install the Python dependency into the runtime that `PDF_PYTHON` points to. Set `PDF_FONT_PATH` to a TrueType font covering the languages used in client answers if your host lacks a suitable default font. A bold file beside it with the same name plus `-Bold` is used for headings.
3. Use [.env.example](.env.example) as the configuration template. Set `NODE_ENV=production`, the real HTTPS `APP_ORIGIN`, the absolute `DATABASE_PATH`, and a persistent, random `LINK_SECRET`. A command to generate the secret is shown below. Keep these settings in the service environment or an untracked `.env` with restricted access.
4. Terminate TLS at a reverse proxy, preserve the public `Host` header and route to the configured `HOST` and `PORT`. Allow JSON import requests up to 5 MiB. Exclude authorization headers, cookies and token-bearing onboarding and setup URLs from proxy logs. Start the service with `npm start` and check `/api/health`.
5. Run the bootstrap command below once. Open the one-time setup link to set the first admin’s password. From **Admin → Accounts**, invite another admin and the partner managers as members. Share each one-time link privately. Admins can also issue a password reset link. On a client’s **Overview**, open **Team access** to set the owner and the teammates who manage that account.
6. For the existing records, review [the import format](docs/IMPORT.md), load the team’s JSON and reconcile the preview counts. In **Admin → Accounts**, turn on **Receive onboarding alerts** for the designated team members with client access.
7. Configure [Claude and MCP access](docs/MCP.md). Pilot one onboarding submission, one match search and one matched mail thread before switching the onboarding link and retiring the previous form.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run admin:create -- "First Admin" admin@example.com
npm start
```

Admins manage accounts, client access, Claude credentials and the audit log. Members can open opportunities they own and work in their assigned clients. Staff activity records the named user. The audit log also records account changes, sign-ins, stage changes, card and match decisions, profile views and exports, report changes, imports, and MCP activity. Claude job writes carry the `claude` actor and its credential ID.

Run `npm run db:backup -- /path/to/new-backup.sqlite` for an online SQLite backup. Schedule protected, off-host backups and test restoration on a separate volume. Retain the configured `LINK_SECRET` for existing onboarding links. For restore, stop the app and restore the backup as the configured database on a clean volume before starting it. This deployment model uses one writable Node instance with persistent local storage.

## Verify

```sh
npm test
```

The integration tests use temporary loopback servers and isolated SQLite data. They exercise role enforcement, restart persistence and the database upgrade, the client journey from prospect to delivery, onboarding and its PDF, the matching brief and saved matches, match decisions, the monthly report and its PDF, Today and alerts, MCP access and replays, and atomic JSON imports. A live rollout requires the persistent volume, domain and TLS, account setup, the real migration file, and the team-side Claude schedule and credentials.
