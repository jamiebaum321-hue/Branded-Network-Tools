# Branded sales and delivery

## Staff access and existing data

Use one persistent SQLite volume and a single writable Node process. Back up an existing installation before upgrading. Version 2 maps every existing Solutions client to an active advisory engagement, retains client and contact IDs, and preserves dates, permissions, introduction records and form links. Pre-existing client records have no inferred signature date or recognized monthly revenue. New opportunities can share a company across lines. Terms and ownership belong to each engagement.

Invite staff in **Settings → Team** and choose workspace access and invitation delivery. The email option requires a configured Microsoft 365 sender. Copy-link invitations also work locally. Use **Settings → Workspace settings** for subsequent access changes. Administrators have access to all three. A member sees the deals they own or have been assigned. Solutions sales and delivery share the client’s access list. A client can have multiple engagements, each with its own terms, sales stage and agreement. Set the named administrators, accounting recipient, podcast owner and public inquiry owners using Branded's confirmed roster.

For a migrated client with an executed contract, use **Record existing agreement** to confirm its original signature date and attach or link the document. The record keeps its delivery stage and client history. Staff choose whether accounting needs a notice for that historical agreement.

## Working an engagement

The workspace switcher sits beneath Branded Network. Solutions opens Pipelines. Media and Capital display **Under construction**.

| Starting point | Staff workflow |
| --- | --- |
| Pipelines | Move opportunities through Outreach, Discovery, First engagement, Second engagement, Agreement sent and Signed. Create the client when starting the engagement, or search for an existing client. Stage colors stay with their stages when an admin renames or drags them. Signing the agreement starts delivery on the same client and queues the accounting handoff. |
| Project management | Select a project from the library, or create one with an icon, stages and assigned clients. Use the project’s three-dot menu to edit or delete it. Open the board to see the client-by-milestone grid. Select a client for its goals and deliverables, or select a cell to set a status, owner, due date and notes. Track intake, goals, deliverables, kickoff email, initial ICP contact and first report, followed by five follow-ups. Each calendar month has its own monthly follow-up. Submitted intake and recorded report delivery mark their milestones complete. |
| Paused and closed opportunities | In Project management, pause an unsigned opportunity with a revisit date, record a loss with its reason, or return it to Outreach. |
| Client → Advisory intake | Select Send client intake form to send through the configured workspace mailbox. The local demo opens an addressed email draft. Copy link lets you share the form yourself. The nine sections collect the ICP, customers, priority targets, sales pipeline, partnerships, integrations, assets, growth priorities and key team contacts. Clients can share existing files in any format up to 25 MiB each, including logos. Choose the target, strategic partner or team list purpose to populate the map or client group from a CSV or XLSX with named columns. The reader supports 6 MiB lists and indexes up to 250 rows per file. The submitted version retains its attachments. |
| Client → Introduction map | Submitted priority targets and channel partners, approved contact activity, research and working notes feed a client-rooted map. Each node shows its sources, introduction status, relationship owner, next action and optional follow-up date. Staff can mark relationship health green, yellow or red. New connections start unrated. |
| Client → Notes and Client group | Add notes for staff and Claude. Existing names link to their cards. The target fields or labeled target and partner lines create new map nodes. Client group collects first and last names, functions, job titles, emails, phone numbers and notes. |
| Client → Engagement and Weekly updates | Confirm invoice terms and access agreement files. Accounting receives one signing notice and a supplement when the billing address is later supplied. Select an engagement to see its records. Weekly updates combines activity across the client’s engagements. Choose the dates, preview the contents, and download that revision as PDF or Excel. |

The version 3 upgrade preserves old Solutions discussion and first-meeting entries in activity history and places those prospects in First engagement. Existing clients stay available in Project management.

Each client's weekly update captures completed work in the chosen period and open work at its cutoff. Owners choose which engagement activity can appear in a client draft. Introduction-card emails contribute the existence of a send or reply. Save edits before downloading the reviewed update as a PDF or Excel workbook. Exports use the saved revision and can also be downloaded after delivery. Use **Send by email** for the reviewed message or **Record sent separately** after delivering the files yourself. Money is recorded in USD.

## Microsoft 365 delivery

Set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` and `MAIL_SENDER` in the service environment. Set `ACCOUNTING_EMAIL` to Adrian's confirmed address, `MEDIA_MAILBOX` to the designated campaign mailbox, `PODCAST_MAILBOX` to the monitored podcast mailbox, and `PODCAST_OWNER_EMAIL` to Julie's enabled Media account. The demo uses synthetic recipients and never starts the mail worker.

Branded's Microsoft 365 administrator must grant mailbox read access for the selected inputs and send access for the designated sender and podcast mailbox. Restrict the application's mailbox access within Exchange. The worker authenticates with client credentials, reads per-folder deltas and replies to eligible guest pitches in their original message thread. [Microsoft client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow) · [Folder delta synchronization](https://learn.microsoft.com/en-us/graph/delta-query-messages) · [Message replies](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0)

Mailbox tracking begins at activation. Cursors survive restarts. Duplicate messages or repeated guest threads reuse their existing records. When a tracked correspondent belongs to multiple campaigns, an administrator chooses the correct engagement under **Media messages to match**. The open indicator defaults to Unknown. Staff can enter an observed open when the sending platform supplies evidence.

Signed agreements small enough for the mail packet accompany the accounting message as attachments. Larger agreements receive a 14-day, single-file download URL. An entered external agreement link retains its original access settings. Previously saved reports remain available. Weekly updates on the client profile is a read-only export. Delivery states distinguish queued, sending, accepted, failed and uncertain. For uncertain deliveries, check the sender's Sent Items before confirming or retrying in Workspace settings. Microsoft acceptance is a handoff to the mail service. [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

## Release and operations

1. Set the real internal hostname, TLS, persistent volume, account roster, distribution owners and mailboxes. Run an online backup and verify that a restored copy opens. Keep the stable link secret with the protected deployment configuration.
2. Use an isolated test tenant or approved test recipients for the first live packet, guest reply and weekly report. Verify who received them and what each contained. Confirm an unassigned account cannot open the same engagement or download its files.
3. Confirm the Claude identities, workspace permissions and data sources. Run an introduction search using a pilot client. Verify the sources, save its findings, and have the owner review the proposed weekly update.
4. Start the service under the host's process supervisor, check `/api/health`, check the worker logs for mailbox errors and inspect email delivery in Workspace operations. Back up the database and its stored files with `npm run db:backup`. For a rollback to version 1, restore the version 1 backup into a separate clean volume.

The 7 a.m. personal email briefing is scheduled inside Branded's Claude workspace. Its roster, approved distributions, calendars and personal source permissions belong to that separate event. A connected personal identity can read its assigned Branded work and outstanding podcast pitches if those sources are included in its brief.
