# Branded Network Tools

Solutions Partner Pipeline gives the partner manager one place to follow up, review leads and manage client onboarding.

| Screen | Workflow |
| --- | --- |
| Today | Open due follow-ups, drafts, newly logged replies and pending leads for the signed-in owner. |
| Pipeline | Browse To Contact, Reached Out, In Conversation and Closed. Drag cards between stages on desktop or use **Edit contact & stage** on a phone or keyboard. Review and edit drafts, open a prefilled message in your email app, and log activity. |
| Metrics | Filter stage counts, time in stage, overdue follow-ups, logged sends and logged replies by owner, client and date. |
| Suggested leads | Search by person or company and filter by client, review status, fit and source. Review the evidence and approve a lead into To Contact or dismiss it. |
| Clients | Share the client-scoped onboarding link, reopen submitted versions and export a selected response to PDF. |
| Admin | Invite admins and members, manage client access, issue Claude credentials, review the audit log, and preview and apply a JSON migration. |

The in-app bell covers due follow-ups, logged replies, stage changes and new submissions. The team’s Claude job owns mailbox polling, lead discovery and email delivery. The app exchanges state and events with that job over MCP. Managers send outreach from their own email app.

## Deploy on Vercel

The app runs as one Vercel function (`api/index.mjs`) backed by Postgres (Neon). Browser assets are served from Vercel's CDN. The database schema is created automatically on the first request.

1. Import the repository into Vercel. `vercel.json` sets the build, the function, the `iad1` region (next to Neon `us-east-1`) and a daily cleanup cron.
2. In **Project → Settings → Environment Variables**, set `DATABASE_URL` (Neon's pooled connection string), a random `LINK_SECRET`, and a random `CRON_SECRET`. Set `APP_ORIGIN` only when using a custom domain; otherwise the production `vercel.app` domain is used. Mark the secrets as sensitive. A command to generate them is shown below.
3. To create the first admin, also set `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL` and a random 43-character `BOOTSTRAP_SETUP_TOKEN`, then redeploy and open `https://<app-host>/setup/<token>` to set the password. Remove the three variables afterwards. From **Admin → Accounts**, invite another admin and the partner managers as members. Share each one-time link privately. Admins can also issue a password reset link. From **Clients**, set the client owner and grant access to the teammates who manage that account.
4. For the existing records, review [the import format](docs/IMPORT.md), load the team’s JSON and reconcile the preview counts. In **Admin → Accounts**, turn on **Receive onboarding alerts** for the designated team members with client access.
5. Configure [the Claude job and MCP access](docs/MCP.md). Pilot one submission and one matched mail thread. Verify the team receives the new-submission alert through Claude before switching the onboarding link and retiring the previous HubSpot form email.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Preview deployments use the same environment variables. Point previews at a separate Neon branch if they should not share production data.

## Run elsewhere

Install Node.js 24, copy [.env.example](.env.example) to an untracked `.env`, set `DATABASE_URL`, `APP_ORIGIN` and `LINK_SECRET`, and run `npm ci && npm start`. Terminate TLS at a reverse proxy that preserves the `Host` header, and set `TRUST_PROXY=1` if it sets `X-Forwarded-For`. `npm run admin:create -- "First Admin" admin@example.com` prints a one-time setup link.

Admins manage accounts, clients, job access and the audit log. Members work in their assigned clients. Staff activity records the named user. The audit log also records account changes, sign-ins, card and lead actions, intake views and exports, imports, and MCP activity. Claude job writes carry the `claude` actor and its credential ID.

Neon keeps point-in-time history for the database; use a Neon branch to inspect or restore an earlier state. Keep the configured `LINK_SECRET` so existing intake links keep working.

## Verify

```sh
TEST_DATABASE_URL=postgresql://localhost/disposable npm test
```

The integration tests use temporary loopback servers and a fresh Postgres schema per test (dropped afterwards). Point `TEST_DATABASE_URL` at a disposable database, never production. They exercise role enforcement, restart persistence, MCP access and replays, lead decisions, Today and alerts, onboarding and PDF, and atomic JSON imports. A live rollout requires the Vercel environment variables, account setup, the real migration file, and the team-side Claude schedule and credentials.
