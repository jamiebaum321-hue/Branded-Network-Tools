import { clientScope } from './store.mjs';
import { presentClient } from './clients.mjs';
import { contractWarningDays, staleIntroDays } from '../public/account-fields.mjs';

const dayMs = 86400000;

// The calendar date in the workspace time zone, as YYYY-MM-DD.
export function workspaceDay(timeZone, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

export function contractFlag(daysLeft) {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return 'ended';
  if (daysLeft <= contractWarningDays.act) return 'act';
  if (daysLeft <= contractWarningDays.soon) return 'soon';
  return null;
}

// What the Solutions team owes this week: account next steps, open intros gone quiet and contracts near their end.
export async function followUps(store, actor, timeZone, now = new Date()) {
  const today = workspaceDay(timeZone, now);
  const [scope, args] = clientScope(actor, 'c.id');
  const accounts = (await store.all(`SELECT c.*,u.name AS owner_name FROM clients c JOIN users u ON u.id=c.owner_id
    WHERE (${scope}) AND c.stage<>'passed' AND c.next_step<>'' ORDER BY c.next_due NULLS LAST,lower(c.name)`, ...args)).map(row => {
    const days = row.next_due ? daysBetween(today, row.next_due) : null;
    return { ...presentClient(row), days, bucket: days === null ? 'no_date' : days < 0 ? 'overdue' : days <= 7 ? 'week' : 'later' };
  });
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - staleIntroDays * dayMs).toISOString();
  const [cardScope, cardArgs] = clientScope(actor, 'p.client_id');
  const intros = await store.all(`SELECT * FROM (SELECT p.id,p.client_id,p.company,p.person,p.stage,p.intro_status,p.next_step,p.introduced_by,
      c.name AS client_name,u.name AS owner_name,
      greatest(p.entered_at,(SELECT max(a.occurred_at) FROM activity a WHERE a.card_id=p.id AND a.kind IN ('sent','reply','note','introduction'))) AS last_touch
    FROM cards p JOIN clients c ON c.id=p.client_id JOIN users u ON u.id=p.owner_id
    WHERE (${cardScope}) AND p.stage IN ('reached_out','in_conversation')) open WHERE last_touch<?
    ORDER BY client_name,last_touch LIMIT 300`, ...cardArgs, cutoff);
  const contracts = (await contractRows(store, actor, today)).filter(row => ['act', 'soon'].includes(row.flag)
    || (row.flag === 'ended' && row.days_left >= -contractWarningDays.act && row.stage === 'current'));
  return { today, accounts, intros: intros.map(row => ({ ...row, days_quiet: daysBetween(row.last_touch.slice(0, 10), today) })), contracts };
}

async function contractRows(store, actor, today) {
  const [scope, args] = clientScope(actor, 'c.id');
  const rows = await store.all(`SELECT c.*,u.name AS owner_name FROM clients c JOIN users u ON u.id=c.owner_id
    WHERE (${scope}) AND c.stage IN ('current','referral') AND (c.contract_start IS NOT NULL OR c.contract_end IS NOT NULL)
    ORDER BY c.contract_end NULLS LAST,lower(c.name)`, ...args);
  return rows.map(row => {
    const daysLeft = row.contract_end ? daysBetween(today, row.contract_end) : null;
    return { ...presentClient(row), days_left: daysLeft, flag: contractFlag(daysLeft),
      auto_renew: /renews? automatically|auto[- ]?renew/i.test(row.renewal_terms) && !/no auto/i.test(row.renewal_terms) };
  });
}

export async function contracts(store, actor, timeZone, now = new Date()) {
  const today = workspaceDay(timeZone, now);
  const items = await contractRows(store, actor, today);
  const monthly = items.filter(row => row.stage === 'current' && (row.days_left ?? 0) >= 0).reduce((sum, row) => sum + (row.monthly_fee ?? 0), 0);
  return { today, items, monthly_retainers: monthly };
}
