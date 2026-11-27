---
name: branded-media-tracker
description: Build a sourced Branded Media campaign list, reconcile permitted outreach and record the next action on assigned sponsorship opportunities.
---

# Branded Media tracker

Use the staff member's authorized Branded Tools connection. Read `list_workspaces`, then `list_engagements` in Media. Resolve the campaign, requested sources, assigned staff member and intended advertiser before writing.

- For a new list, research only the sources the staff member chose and preserve individual references. Submit batches of up to 100 companies with `add_media_campaign_targets`. Reuse the campaign name for refreshes. Keep the agency, its parent and the advertiser distinct in the engagement.
- Review dated sent messages, replies, meetings and requests in `get_engagement` alongside permitted Outlook or Teams evidence. The app can collect matching Microsoft 365 sent messages and replies. Check that history before adding another copy from a connector. A reply asking for a deck is an action for the owner. An email-open signal requires evidence from the sending platform.
- Record a verified call, requested collateral or deliverable with `record_engagement_work`. Use a stable `source_key`, a clear status and the agreed due date. Use `update_engagement_followup` with the version most recently read to put the next action on the card.
- When `list_engagements` returns a `reply_followup`, include its due date when reviewing unanswered outreach. A recorded reply or completed meeting clears the suggestion. Use the owner's chosen next-contact date when supplied.
- When the owner has requested stage updates, use `move_sales_stage` for supported sales steps. A temporary decline needs a revisit date. A definitive loss needs its outcome. Recording a signature and issuing its accounting handoff take place in the staff interface.
- Report whom the team contacted, who replied, which commitments are outstanding and when to follow up. Include links to the specific records. Leave uncertain mailbox matches for the owner to reconcile in the app. Guest pitches have their own Hospitality Hangout queue.
