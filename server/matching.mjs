import { stageInfo } from '../public/lifecycle.mjs';
import { AppError, audit, clientFor, requireAssistant } from './store.mjs';
import { clientProfile } from './clients.mjs';
import { evidenceSchema, insertSuggestion } from './pipeline.mjs';
import { list, num, object, str, validate } from './validation.mjs';

const slug = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150);
const rows = (value, keys) => (Array.isArray(value) ? value : []).map(row => Object.fromEntries(keys.filter(key => row[key]).map(key => [key, row[key]])))
  .filter(row => Object.keys(row).length);

export const matchSchema = object({ company: str(180), person: str(150, 0), title: str(160, 0), email: str(254, 0), reason: str(2500),
  source: str(160), fit: str(120), score: num(0, 100), relationship: str(600, 0), evidence: evidenceSchema, candidate_key: str(400) },
['company', 'reason', 'source']);
export const saveMatchesSchema = object({ client_id: str(80), matches: list(matchSchema, 25) });

// Everything Claude needs to search for a client's ideal customers, and everyone it must leave out.
export function matchingBrief(store, actor, clientId, config) {
  const client = clientFor(store, actor, clientId);
  const profile = clientProfile(store, clientId);
  const a = profile?.answers ?? {};
  const matched = store.all(`SELECT company,person,status FROM suggestions WHERE client_id=? ORDER BY created_at DESC LIMIT 400`, clientId);
  const pipeline = store.all(`SELECT company,person,stage FROM cards WHERE client_id=? ORDER BY updated_at DESC LIMIT 400`, clientId);
  return {
    client: { id: client.id, name: client.name, stage: stageInfo[client.stage].label, website: client.website || a.website || '' },
    profile_status: profile ? `Onboarding version ${profile.version}, ${profile.completeness}% complete` : 'No onboarding answers yet',
    ...(profile ? {} : { warning: 'This client has not completed onboarding. Ask the manager to send the onboarding link before searching.' }),
    what_they_sell: { summary: a.pitch ?? '', categories: a.category ?? [], products: a.product ?? '', differentiators: a.differentiators ?? '',
      proof_points: a.proof_points ?? '', typical_deal: a.pricing ?? '' },
    ideal_customer: { description: a.icp ?? '', segments: a.segments ?? [], segment_notes: a.segment ?? '', ownership: a.ownership ?? [],
      geography: a.geography ?? '', locations: { minimum: a.minimum_locations ?? null, ideal: a.ideal_locations ?? null, maximum: a.maximum_locations ?? null },
      other_criteria: a.footprint ?? '', technology: a.tech_requirements ?? '', good_fit_signals: a.buying_triggers ?? '', not_a_fit: a.disqualifiers ?? '' },
    buyers: { people_to_reach: rows(a.personas, ['title', 'department', 'role', 'notes']), what_they_care_about: a.buyer_notes ?? '',
      qualified_introduction: a.qualified_intro ?? '' },
    priority_targets: rows(a.priority_targets, ['company', 'contact', 'link', 'notes']),
    exclude: {
      current_customers: rows(a.current_customers, ['company', 'link', 'notes']),
      deals_in_progress: rows(a.sales_pipeline, ['company', 'contact', 'status']),
      competitors: rows(a.competitors, ['company']).map(row => row.company),
      named_by_client: a.exclusions ?? '',
      already_matched: matched, already_in_pipeline: pipeline,
    },
    how_to_save: 'Call save_matches with this client_id and up to 25 matches per call. Each match needs company, reason (why it fits this profile) '
      + 'and source (where you found it, for example HubSpot, Outlook or Teams). Add person, title, email, relationship (how Branded knows them), '
      + 'a 0-100 score and evidence when you have them. Saving the same company and person again is safe. Matches wait for the manager to approve.',
    review_url: new URL(`/clients/${client.id}?tab=matches`, config.origin).href,
  };
}

export function saveMatches(store, actor, input, config) {
  requireAssistant(actor);
  const data = validate(saveMatchesSchema, input);
  if (!data.matches.length) throw new AppError(400, 'Include at least one match.');
  return store.tx(() => {
    const client = clientFor(store, actor, data.client_id);
    const results = data.matches.map((match, index) => {
      const person = match.email || match.person;
      const key = match.candidate_key ?? `company:${slug(match.company)}${person ? `|person:${slug(person)}` : ''}`;
      const inPipeline = store.get(`SELECT id FROM cards WHERE client_id=? AND lower(company)=lower(?) AND (?='' OR lower(person)=lower(?)) LIMIT 1`,
        client.id, match.company, match.person ?? '', match.person ?? '');
      if (inPipeline) return { company: match.company, person: match.person ?? '', result: 'already_in_pipeline', card_id: inPipeline.id };
      const score = match.score ?? null;
      let saved;
      try {
        saved = insertSuggestion(store, actor, { client_id: client.id, company: match.company, person: match.person, title: match.title,
          email: match.email, reason: match.reason, source: match.source, candidate_key: key, score,
          fit: match.fit || (score === null ? 'Unrated' : score >= 80 ? 'Strong' : score >= 60 ? 'Moderate' : 'Weak'),
          branded_relationship: match.relationship || 'Unknown',
          evidence: match.evidence ?? [{ source: match.source, detail: match.reason }] });
      } catch (error) {
        if (error instanceof AppError) throw new AppError(error.status, `Match ${index + 1} (${match.company}): ${error.message}`);
        throw error;
      }
      return { company: match.company, person: match.person ?? '', result: saved.existing ? 'already_saved' : 'saved', suggestion_id: saved.id };
    });
    const count = result => results.filter(row => row.result === result).length;
    audit(store, actor, 'matches.saved', 'client', client.id, client.id, { saved: count('saved'), existing: results.length - count('saved') });
    return { client: client.name, saved: count('saved'), already_saved: count('already_saved'), already_in_pipeline: count('already_in_pipeline'),
      matches: results, review_url: new URL(`/clients/${client.id}?tab=matches`, config.origin).href,
      next: 'Matches are waiting for the manager to approve or dismiss in the app.' };
  });
}
