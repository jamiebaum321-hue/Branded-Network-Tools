# Branded sales and delivery

## Staff access and existing data

Use one persistent SQLite volume and a single writable Node process. Back up an existing installation before upgrading. Version 2 maps every existing Solutions client to an active advisory engagement, retains client and contact IDs, and preserves dates, permissions, introduction records and form links. Pre-existing client records have no inferred signature date or recognized monthly revenue. New opportunities can share a company across lines. Terms and ownership belong to each engagement.

Invite each staff member in Admin, then assign their lines under Workspace operations. Administrators have access to all three. A member sees the deals they own or have been assigned. The engagement owner and additional team on a signed Solutions engagement also have access to its advisory client record. Set the named administrators, accounting recipient, podcast owner and public inquiry owners using Branded's confirmed roster.

For a migrated client with an executed contract, use **Record existing agreement** to confirm its original signature date and attach or link the document. The record keeps its delivery stage and client history. Staff choose whether accounting needs a notice for that historical agreement.

## Working an engagement

All three sales boards offer Outreach, Discovery, First engagement, Second engagement, First meeting scheduled and In discussion. Staff can use the checkpoints in the order a conversation unfolds, skip a step or return to it. Record the first meeting date independently of the next follow-up. **Jump to stage** shows how many matching deals each column contains and opens that column on desktop or mobile.

| Workspace | From discussion to agreement | After signing |
| --- | --- | --- |
| Solutions | Agreement sent | Signed → Onboarding → Active advisory → Completed |
| Media | Pitch requested → Agreement sent | Signed → In production → Completed |
| Capital | Mandate sent | Signed → Raising capital → Completed |

Signed records the win. Staff can move an unsigned opportunity to **Cold / nurture** with a revisit date, resume outreach, or record **Closed lost** with an outcome. For a signed Media project, **Delivery → Project billing** shows its invoice status, reference and promised deliverables alongside the production stage.

In **Media → Conversations**, a logged outgoing message with no later reply or completed meeting gets a suggested follow-up date. It appears on Today when due. The default is three calendar days in the workspace time zone. Set `MEDIA_FOLLOWUP_DAYS` to change the interval. A staff-set follow-up date, an open dated contact task or a scheduled first meeting with a current or future date takes precedence. Moving a deal to nurture uses its revisit date. Staff decide whether to send another message.

| Starting point | Staff workflow |
| --- | --- |
| Solutions → Sales pipeline | Create the prospect, enter contact and next action, and record conversations. Enter the negotiated retainer, term and referral terms. Upload the executed SCA or record its HTTPS location. Move to Signed. |
| Signed Solutions → Overview | Confirm accounting contact and invoice terms. The signing event queues one notice. A later first billing address queues one supplement. Accounting enters the customer in QuickBooks and staff record invoice setup, invoice reference and payment status. |
| Advisory intake | Share the expiring form link. Clients can save answers, add repeatable entries and upload logos, Excel, CSV, PDF or images up to 5 MiB each. The app stores files with the submitted version. The current nine-area summary, logo and assets are visible on the engagement. |
| Introductions → Weekly updates | Run research from the client's profile or add evidence manually. Review proposals, log the actual introduction and record replies and outcomes. Record newsletter or social coverage as client-reportable activity. Generate or open the weekly draft, edit it, choose its recipient and send or record separate delivery. |
| Media → Conversations | Add a sourced list or create individual opportunities. Filter by campaign and assignee. Track advertiser, agency, parent, last contact, replies, requests and next action. Add a dated deliverable for each promised placement or event. A cold lead requires a return date. A definitive loss requires an outcome. |
| Media → Guest pitches | The podcast mailbox feeds the guest queue. Recognized first pitches queue one acknowledgement. Ambiguous incoming messages go to staff for classification. Members see their own pitches. Admins can route unassigned work. |
| Capital | Record the raise target, fee percentage and terms, retainer and term. Move from mandate to Signed and then Raising capital. Enter actual capital raised and track milestones in Activity. The indicative success fee uses the recorded amount raised and percentage. Accounting determines recognition from the signed agreement. |
| Workspace operations → Inbound inquiry links | Create a public link for the chosen business line, source and owner. Distribute it through the approved site or campaign. A submission creates an assigned sales opportunity and stores the inquiry. The form can be retired independently. |

Each client's weekly update captures completed work in the chosen period and open work at its cutoff. Owners choose which engagement activity can appear in a client draft. Introduction-card emails contribute the existence of a send or reply. Save edits before downloading the reviewed update as a PDF or Excel workbook. Exports use the saved revision and can also be downloaded after delivery. Use **Send by email** for the reviewed message or **Record sent separately** after delivering the files yourself. Money is recorded in USD.

## Microsoft 365 delivery

Set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` and `MAIL_SENDER` in the service environment. Set `ACCOUNTING_EMAIL` to Adrian's confirmed address, `MEDIA_MAILBOX` to the designated campaign mailbox, `PODCAST_MAILBOX` to the monitored podcast mailbox, and `PODCAST_OWNER_EMAIL` to Julie's enabled Media account. The demo uses synthetic recipients and never starts the mail worker.

Branded's Microsoft 365 administrator must grant mailbox read access for the selected inputs and send access for the designated sender and podcast mailbox. Restrict the application's mailbox access within Exchange. The worker authenticates with client credentials, reads per-folder deltas and replies to eligible guest pitches in their original message thread. [Microsoft client credentials](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow) · [Folder delta synchronization](https://learn.microsoft.com/en-us/graph/delta-query-messages) · [Message replies](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0)

Mailbox tracking begins at activation. Cursors survive restarts. Duplicate messages or repeated guest threads reuse their existing records. When a tracked correspondent belongs to multiple campaigns, an administrator chooses the correct engagement under **Media messages to match**. The open indicator defaults to Unknown. Staff can enter an observed open when the sending platform supplies evidence.

Signed agreements small enough for the mail packet accompany the accounting message as attachments. Larger agreements receive a 14-day, single-file download URL. An entered external agreement link retains its original access settings. A weekly update is immutable after it is queued or recorded as sent. Delivery states distinguish queued, sending, accepted, failed and uncertain. For uncertain deliveries, check the sender's Sent Items before confirming or retrying in Workspace operations. Microsoft acceptance is a handoff to the mail service. [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

## Release and operations

1. Set the real internal hostname, TLS, persistent volume, account roster, distribution owners and mailboxes. Run an online backup and verify that a restored copy opens. Keep the stable link secret with the protected deployment configuration.
2. Use an isolated test tenant or approved test recipients for the first live packet, guest reply and weekly report. Verify who received them and what each contained. Confirm an unassigned account cannot open the same engagement or download its files.
3. Confirm the Claude identities, workspace permissions and data sources. Run an introduction search using a pilot client. Verify the sources, save its findings, and have the owner review the proposed weekly update.
4. Start the service under the host's process supervisor, check `/api/health`, check the worker logs for mailbox errors and inspect email delivery in Workspace operations. Back up the database and its stored files with `npm run db:backup`. For a rollback to version 1, restore the version 1 backup into a separate clean volume.

The 7 a.m. personal email briefing is scheduled inside Branded's Claude workspace. Its roster, approved distributions, calendars and personal source permissions belong to that separate event. A connected personal identity can read its assigned Branded work and outstanding podcast pitches if those sources are included in its brief.
