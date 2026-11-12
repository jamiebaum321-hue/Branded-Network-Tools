# Import existing Solutions records

The one-time import accepts version 1 JSON. Start with the [fictional example](../examples/seed.example.json). Keep the actual exports in private storage. Invite owners and reviewers before using their email addresses in the file.

| Record set | Required fields | Mapping |
| --- | --- | --- |
| `clients` | `id`, `name` | Set `owner_email` when known. Otherwise the importing admin owns the client initially. |
| `partners` | `id`, `client_id`, `company` | Include person, title, email, relationship, stage, owner, next step, outcome and follow-up when available. `created_at` and `entered_at` preserve known card and stage dates. |
| `introductions` | `id`, `client_id` | Use `partner_id` to add to a linked card. With no partner ID, supply `company` and optional card fields to create the card. Preserve `occurred_at`, `status`, `notes` and `outcome`. |
| `outreach_activity` | `id`, `client_id`, `partner_id`, `kind`, `occurred_at` | Use `sent`, `reply` or `note`. Include subject, body, message reference and both mailbox scope and Outlook message ID when known. |
| `suggested_leads` | `id`, `client_id`, `company`, `reason`, `source` | Export open leads. Supply `candidate_key` using the discovery job’s stable ID where available, plus fit, evidence, relationship, score and `reviewer_email` if assigned. |
| `onboarding_submissions` | `id`, `client_id`, `submitted_at`, `answers` | Include all clients’ submitted forms, including multiple versions. Preserve `form_version` and `source_ref` when known. `answers` uses the app’s [field keys](../public/intake-fields.mjs). |

Normalize stages to `to_contact`, `reached_out`, `in_conversation` or `closed`. Include a closure outcome for closed cards and omit their follow-up dates. For incomplete legacy submissions, include the fields present in the export. For repeatable fields, map linked lists to the field’s `link` value. Use ISO timestamps with an offset or `Z`. Place earlier onboarding snapshots first for each client so local version numbers follow the submission history.

Open **Admin → Import JSON**, choose the file and select **Preview import**. Verify added, skipped and invalid counts and resolve errors before applying. Each apply is atomic. The `namespace`, record set and stable source `id` identify a record across runs. Use the same identifiers on a retry. Imports with the same IDs preserve existing data and decisions. Use up to 5,000 records and 5 MiB per batch. Keep the same namespace for related batches and import referenced clients and partners first.

Imported submissions and historical replies appear in the archive or card activity. Imported replies contribute to historical metrics. Existing due follow-ups and open suggestions enter the normal work queues. Reconcile sample cards, stage dates, past PDFs and pending leads before enabling the scheduled job.
