import { listAccounts, rateLimit } from './accounts.mjs';
import { AppError, audit } from './store.mjs';
import {
  addTargets,
  changeDeal,
  createDeal,
  deals,
  dueWork,
  finishItem,
  recordItem,
  setMembership,
  shareDeal,
  todayKey,
  workspaceAccounts,
  workspaceLines,
} from './engagements.mjs';
import { dealDetail, newReport, research, updateReport } from './delivery.mjs';
import { engagement, recordHistoricalAgreement } from './engagements.mjs';
import { skillBundle, skillLines } from './skills.mjs';
import { authorizedFile, billingDownload, dealUpload, intakeUpload, sendFile, uploadLimit } from './files.mjs';
import { changePitch, createSource, pitches, source, submitInquiry } from './inquiries.mjs';
import { ready, reconcileMatch, resolveMail } from './mail.mjs';
import { salesStages } from '../public/business-lines.mjs';
import { weeklyReportFile } from './pdf.mjs';

const key = '([\\w-]{1,80})';
const line = '(solutions|media|capital)';
export function registerWorkspaceRoutes(route, s, config) {
  route('POST', '/api/engagements/' + key + '/existing-agreement', ({ actor, ids, data }) =>
    recordHistoricalAgreement(s, actor, ids[0], data, config)
  );
  route('GET', '/api/skills/(' + Object.keys(skillLines).join('|') + ')', ({ actor, ids, res }) =>
    skillBundle(s, actor, ids[0], res)
  );
  route('GET', '/api/workspaces', ({ actor }) => ({ lines: workspaceLines(s, actor) }));
  route('GET', '/api/work-due', ({ actor }) => ({ items: dueWork(s, actor, config) }));
  route('POST', '/api/workspaces/media/targets', ({ actor, data }) => addTargets(s, actor, data));
  route('GET', '/api/workspaces/' + line, ({ actor, ids: [line] }) => ({
    deals: deals(s, actor, line, config),
    owners: workspaceAccounts(s, actor, line),
    today: todayKey(config.timeZone),
  }));
  route('POST', '/api/workspaces/' + line + '/engagements', ({ actor, data, ids }) =>
    createDeal(s, actor, ids[0], data)
  );
  route('GET', '/api/engagements/' + key, ({ actor, ids }) => dealDetail(s, actor, ids[0]));
  route('PATCH', '/api/engagements/' + key, ({ actor, ids, data }) =>
    changeDeal(s, actor, ids[0], data, config)
  );
  route('PUT', '/api/engagements/' + key + '/team', ({ actor, ids, data }) =>
    shareDeal(s, actor, ids[0], data)
  );
  route('POST', '/api/engagements/' + key + '/work', ({ actor, ids, data }) =>
    recordItem(s, actor, ids[0], data)
  );
  route('POST', '/api/engagements/' + key + '/research', ({ actor, ids, data }) => {
    const e = engagement(s, actor, ids[0]);
    if (!e.client_id || data?.client_id !== e.client_id)
      throw new AppError(400, 'Choose the current advisory client.');
    return research(s, actor, data);
  });
  route('PATCH', '/api/engagements/' + key + '/work/' + key, ({ actor, ids, data }) =>
    finishItem(s, actor, ...ids, data)
  );
  route('POST', '/api/engagements/' + key + '/reports', ({ actor, ids, data }) =>
    newReport(s, actor, ids[0], data, config.timeZone)
  );
  route('PATCH', '/api/engagements/' + key + '/reports/' + key, ({ actor, ids, data }) =>
    updateReport(s, actor, ...ids, data)
  );
  route('GET', '/api/engagements/' + key + '/reports/' + key + '/(pdf|xlsx)', async ({ actor, ids, url, res }) => {
    const [dealId, reportId, format] = ids;
    const deal = engagement(s, actor, dealId);
    const report = s.get('SELECT * FROM report_versions WHERE id=? AND engagement_id=?', reportId, dealId);
    if (!report) throw new AppError(404, 'Report not found.');
    const revision = url.searchParams.get('version');
    if (revision !== null && revision !== String(report.version))
      throw new AppError(409, 'The report changed. Refresh to download its latest saved revision.');
    const bytes = await weeklyReportFile(report, deal.company, format, config);
    const filename = deal.company.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'client';
    audit(s, actor, 'report.exported', 'report', reportId, deal.client_id, { format, revision: report.version });
    sendFile(res, {
      name: `${filename}-weekly-update-${report.end_day}-v${report.version}.${format}`,
      mime: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes,
    });
  });
  route(
    'POST',
    '/api/engagements/' + key + '/files',
    ({ actor, ids, data }) => dealUpload(s, actor, ids[0], data, config),
    { bodyLimit: uploadLimit }
  );
  route('GET', '/api/files/' + key, ({ actor, ids, res, url }) =>
    sendFile(res, authorizedFile(s, actor, ids[0]), url.searchParams.get('preview') === '1')
  );
  route(
    'GET',
    '/api/accounting-file/' + key,
    ({ ids, res, url, ip }) => {
      rateLimit(s, 'agreement-download:' + ip, 150, 900000);
      sendFile(res, billingDownload(s, config, ids[0], url));
    },
    { public: true }
  );
  route(
    'POST',
    '/api/onboard/([\\w.-]{80})/files',
    ({ ids, data, ip }) => {
      rateLimit(s, 'intake-upload:' + ip, 80, 900000);
      return intakeUpload(s, ids[0], data, config);
    },
    { public: true, bodyLimit: uploadLimit }
  );
  route('GET', '/api/podcast', ({ actor }) => ({ items: pitches(s, actor) }));
  route('PATCH', '/api/podcast/' + key, ({ actor, ids, data }) => changePitch(s, actor, ids[0], data));
  route(
    'GET',
    '/api/inquire/' + key,
    ({ ids, ip }) => {
      rateLimit(s, 'inquiry-read:' + ip, 100, 900000);
      const { line, label } = source(s, ids[0]);
      return { line, label };
    },
    { public: true }
  );
  route(
    'POST',
    '/api/inquire/' + key,
    ({ ids, data, ip }) => {
      rateLimit(s, 'inquiry-submit:' + ip, 15, 900000);
      return submitInquiry(s, ids[0], data);
    },
    { public: true }
  );
  route('GET', '/api/admin/operations', ({ actor }) => ({
    users: listAccounts(s, actor).map((u) => ({
      ...u,
      workspaces: workspaceLines(s, { kind: 'user', id: u.id, role: u.role }),
    })),
    sources: s.all(
      `SELECT s.id,s.label,s.line,s.active,u.name owner,count(i.engagement_id) inquiries,
        sum(CASE WHEN e.stage IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END) in_discussion,
        count(e.signed_at) signed FROM inquiry_sources s JOIN users u ON u.id=s.owner_id
        LEFT JOIN inquiry_entries i ON i.source_id=s.id LEFT JOIN engagements e ON e.id=i.engagement_id GROUP BY s.id ORDER BY s.created_at DESC`,
      JSON.stringify(salesStages.filter((stage) => stage !== 'outreach'))
    ),
    mail: s.all(
      'SELECT id,subject,recipient,kind,status,detail,created_at FROM dispatches ORDER BY created_at DESC LIMIT 150'
    ),
    unmatched: s
      .all(
        'SELECT source_key,summary,occurred_at,candidates FROM unmatched_media_mail WHERE resolved_at IS NULL ORDER BY occurred_at LIMIT 100'
      )
      .map((row) => {
        const item = JSON.parse(row.summary);
        return {
          id: row.source_key,
          subject: item.title,
          notes: item.notes,
          ref: item.external_ref,
          at: row.occurred_at,
          choices: s.all(
            "SELECT e.id,c.name||' · '||e.title||coalesce(' · '||json_extract(e.details,'$.campaign'),'') name FROM engagements e JOIN companies c ON e.company_id=c.id WHERE e.id IN (SELECT value FROM json_each(?))",
            row.candidates
          ),
        };
      }),
    connected: ready(config),
    demo: config.demo,
    accounting: config.accountingEmail || '',
    podcast: config.mail?.podcast || '',
    media: config.mail?.media || '',
  }));
  route('PUT', '/api/admin/accounts/' + key + '/workspaces', ({ actor, ids, data }) =>
    setMembership(s, actor, ids[0], data)
  );
  route('POST', '/api/admin/inquiry-sources', ({ actor, data }) => createSource(s, actor, data));
  route('POST', '/api/admin/media-matches/(graph:[a-f0-9]{64})', ({ actor, ids, data }) =>
    reconcileMatch(s, actor, ids[0], data?.engagement_id)
  );
  route('POST', '/api/admin/inquiry-sources/' + key + '/disable', ({ actor, ids }) => {
    if (!s.run('UPDATE inquiry_sources SET active=0 WHERE id=?', ids[0]).changes)
      throw new AppError(404, 'Inquiry link not found.');
    audit(s, actor, 'inquiry.disabled', 'inquiry_source', ids[0]);
    return { ok: true };
  });
  route('POST', '/api/admin/dispatches/' + key, ({ actor, ids, data }) => {
    const result = resolveMail(s, ids[0], data?.decision);
    audit(s, actor, 'dispatch.reconciled', 'dispatch', ids[0], null, { decision: data.decision });
    return result;
  });
}
