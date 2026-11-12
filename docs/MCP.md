# MCP and the Claude job

The app exposes an authenticated Streamable HTTP endpoint at `https://<app-host>/mcp`. Use the app URL as the resource identifier, including `/mcp`. The Claude scheduled job uses an app-issued bearer credential. Interactive Claude or ChatGPT users use read-only OAuth identities when the operator enables OAuth.

## Configure the scheduled job

In **Admin → MCP access**, create a credential with access to the clients the job manages. Save the displayed token in the job’s secret store. It is shown once. Send it as `Authorization: Bearer <token>` on each MCP request. Create a new credential before expiration and revoke the old one when the replacement works. MCP writes identify the credential as `claude` in audit records.

Run the team’s scheduled job twice a day to start. Keep the timing, mailbox cursor, event cursor and email receipts in the job’s own storage. The same endpoint works if the team changes the schedule.

1. Read relevant cards and activity. Match confirmed Outlook sends and replies to an authorized card. Send each unambiguous match to `log_sent_email` or `log_reply` with the actual mail timestamp and stable message ID. Queue ambiguous matches for staff. A `409` with an activity ID can indicate a possible manual duplicate. The manager can link the stable message ID on the existing activity entry.
2. Read due follow-ups, then prepare drafts from the card and authorized mail history. Call `save_draft` with the follow-up ID. The app creates a fallback when a follow-up first comes due. Claude can replace an untouched fallback. Staff-edited or reviewed drafts stay in place. The manager reviews and sends from the prefilled email composer or copies the draft.
3. Read saved onboarding versions for discovery. Use the team’s existing HubSpot, Outlook and Apollo workflow with its existing credit rules. Exclude named companies and people and respect the form’s exclusions. A linked list is a reference that the job can inspect with its own access. Publish each qualified result with its evidence, relationship, fit and score using `add_suggested_lead`. The manager makes the decision in the app.
4. Read `list_events` starting at the job’s last saved `next_cursor`. Page through results using `has_more`. Use `audience` and `url` for notifications. Deduplicate delivery by `event.id` and recipient in the job. Skip a due event when `actionable` is false. Persist the cursor after handling the page. A failed run can replay the page without duplicating an email if its delivery receipt is already recorded.

### Read tools

| Tool | Result |
| --- | --- |
| `list_pipeline_cards`, `get_pipeline_card` | Card state, owner, stage and entry time, last touch, next step, open follow-up, fit reason and draft status. |
| `list_due_followups` | Due or overdue occurrences with a follow-up ID and available draft ID and status. |
| `list_card_activity` | Recorded sends, replies, notes, introductions, drafts and stage changes. Includes occurrence time, logged time, actor and source references where available. |
| `list_suggested_leads` | Searchable proposals with status, source, fit, evidence, relationship and score. |
| `find_clients` | Client IDs in the caller’s scope. |
| `list_onboarding_submissions`, `get_onboarding_submission` | Archived versions and structured answers with source references. Omit `submission_id` to fetch the latest submission by submission date. |
| `get_onboarding_pdf_link` | A PDF URL that staff can open with app sign-in and access to the client. |
| `list_events` | Cursor-based feed of `follow_up_due`, `reply_logged`, `stage_changed` and `onboarding_submitted`. Job credentials also receive the authorized audience. |

### Write tools

| Tool | Required values | Optional values |
| --- | --- | --- |
| `log_reply` | `card_id`, `mailbox_scope`, `outlook_message_id`, `received_at` | `subject`, `body` excerpt, `message_reference` |
| `log_sent_email` | `card_id`, `mailbox_scope`, `outlook_message_id`, `sent_at` | `subject`, `body` excerpt, `message_reference`, `draft_id` when verified as the draft actually sent |
| `save_draft` | `card_id`, one of `followup_id` or `draft_slot`, `subject`, `body` | `recipient`, `mailbox_scope` and `outlook_message_id` for a mail-derived draft |
| `add_suggested_lead` | `client_id`, `company`, `reason`, `source`, `fit`, `evidence`, `branded_relationship`, `score`, `candidate_key` | `person`, `title`, verified `email`, `mailbox_scope` and `outlook_message_id` for a mail-derived lead |

Use RFC 3339 timestamps with an offset or `Z`. `evidence` is an array of objects with `source`, `detail` and optional `reference`. Reuse a canonical mailbox scope and immutable Outlook message ID across polls and imports. The app returns the original saved result for a replay. One stable draft slot identifies one draft on a card. One stable candidate key identifies one lead for a client and preserves its review status across rediscovery. A lead is created as pending review. Approval, dismissal and stage moves require a staff account in the app.

### Protocol check

```sh
curl --request POST "$APP_ORIGIN/mcp" \
  --header "Authorization: Bearer $BNT_JOB_TOKEN" \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"branded-job","version":"1.0"}}}'
```

Use the negotiated `MCP-Protocol-Version` header on subsequent requests. Send the `notifications/initialized` notification and then use `tools/list` for input schemas and `tools/call` to invoke a tool. Inspect the returned `isError` and status as well as the HTTP response. This endpoint returns JSON responses and works without a persistent transport session.

## Configure interactive read-only access

1. Register this MCP resource with a team-owned OAuth authorization server that provides client registration or pre-registration supported by the chosen Claude or ChatGPT client, authorization-code flow with PKCE, and token introspection. Configure `MCP_ISSUER`, `MCP_INTROSPECTION_URL`, `MCP_INTROSPECTION_CLIENT_ID` and `MCP_INTROSPECTION_CLIENT_SECRET` in the app. The authorization server must issue `pipeline:read` tokens with the exact MCP resource URL as their audience and a stable `sub`.
2. In **Admin → Accounts**, bind each approved reader’s OAuth subject to their active account. The app evaluates that account’s client permissions on each request. A normal member sees their assigned clients, and an admin sees all clients. The interactive identity receives only the read tools.
3. Add the deployed HTTPS `/mcp` URL in the chosen client and authorize the approved reader. Verify `tools/list`, one permitted card, and denial of access to an unassigned client. If the client sends an `Origin` header, allow its exact trusted origin in `MCP_ALLOWED_ORIGINS`.

The application exposes OAuth protected resource metadata at `/.well-known/oauth-protected-resource/mcp` when enabled. Configure authorization and registration on the OAuth server. Connector rollout and available authentication settings depend on the workspace. [Claude custom connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [OpenAI custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) · [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
