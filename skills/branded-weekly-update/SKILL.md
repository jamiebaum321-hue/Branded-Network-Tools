---
name: branded-weekly-update
description: Assemble an evidence-based weekly update for one paying Solutions client and save an editable report for the engagement owner.
---

# Branded weekly client update

1. Use `list_engagements` to find the assigned Solutions engagement or use the identifier supplied by the owner. Read `get_engagement` to verify the client, current priorities and prior reports. Confirm the reporting start and end dates with the request, using the workspace time zone.
2. Call `get_weekly_evidence` for that period. Separate introductions actually made, replies, meetings and outcomes from introductions still planned. Include published newsletter mentions, social coverage and other completed work. Include outstanding actions with their responsible person and date when known. Read-only contacts or a pending research suggestion cannot establish an introduction.
3. Check the underlying evidence if a result is unclear. Log newly verified work with `record_engagement_work`, a stable source key, the activity date and `audience: client` when suitable for the client. Preserve personal correspondence, billing discussions and internal notes in staff records.
4. Write a short client-facing update for this engagement. Name the period, the work Branded completed, the outcomes, open actions and planned introductions. Use plain language and avoid promising outcomes that have yet to occur.
5. Save the draft with `save_weekly_report_draft`. Use a stable key such as the client, period and review cycle. A repeat run returns the existing draft and preserves a staff member's edits. Give the owner the Weekly updates tab to review, edit and send the final version or record separate delivery.
