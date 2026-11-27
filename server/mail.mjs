import { AppError, audit, digest, iso, requireAdmin, system } from './store.mjs';
import { addItem } from './engagements.mjs';
import { accountingFileUrl } from './files.mjs';
import { ingestPitch } from './inquiries.mjs';
import { email } from './validation.mjs';

import { formToken } from './clients.mjs';
import { invitationToken } from './invite-link.mjs';

const graphRoot = 'https://graph.microsoft.com/v1.0';
export function mailSettings(env, demo) {
  if (demo) return {};
  const settings = {
    tenant: env.GRAPH_TENANT_ID,
    app: env.GRAPH_CLIENT_ID,
    secret: env.GRAPH_CLIENT_SECRET,
    sender: email(env.MAIL_SENDER, true),
    media: email(env.MEDIA_MAILBOX, true),
    podcast: email(env.PODCAST_MAILBOX, true),
  };
  if (
    [settings.tenant, settings.app, settings.secret].some(Boolean) &&
    ![settings.tenant, settings.app, settings.secret, settings.sender].every(Boolean)
  ) {
    throw new Error('Configure the three Graph credentials and MAIL_SENDER together.');
  }
  return settings;
}
export function ready(config) {
  const m = config.mail;
  return Boolean(!config.demo && m?.tenant && m.app && m.secret && m.sender);
}
const userPath = (address) => graphRoot + '/users/' + encodeURIComponent(address);
async function tokenFor(mail, request) {
  if (!/^[A-Za-z0-9.-]+$/.test(mail.tenant)) throw new Error('Invalid Graph tenant.');
  const r = await request('https://login.microsoftonline.com/' + mail.tenant + '/oauth2/v2.0/token', {
    method: 'POST',
    redirect: 'error',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: mail.app,
      client_secret: mail.secret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('Graph token request failed with HTTP ' + r.status);
  const t = (await r.json()).access_token;
  if (!t) throw new Error('Missing Graph access token.');
  return t;
}
export function classifyMessage(s, config, { stream, box, folder }, m) {
  if (m['@removed'] || !m.id || m.isDraft) return;
  const address = m.from?.emailAddress?.address?.toLowerCase(),
    subject = m.subject || '',
    body = m.bodyPreview || '';
  if (!address || !m.conversationId) return;
  try {
    email(address);
  } catch {
    return;
  }
  const key = box.toLowerCase() + ':' + m.conversationId;
  if (stream === 'podcast') {
    if (
      address === box.toLowerCase() ||
      /^(re|fw|fwd|automatic reply|out of office|undeliverable|delivery status notification):/i.test(subject) ||
      /^(postmaster|mailer-daemon|no-?reply)@/i.test(address)
    )
      return;
    const headers = new Map(
      (m.internetMessageHeaders || []).map((h) => [h.name.toLowerCase(), String(h.value).toLowerCase()])
    );
    if (
      headers.has('in-reply-to') ||
      headers.has('references') ||
      headers.has('list-id') ||
      (headers.has('auto-submitted') && headers.get('auto-submitted') !== 'no')
    )
      return;
    const confirmed =
      Array.isArray(m.internetMessageHeaders) &&
      /\b(guest|pitch)\b/i.test(subject + ' ' + body) &&
      /\b(podcast|show|hangout|guest (idea|pitch|request))\b/i.test(subject + ' ' + body);
    ingestPitch(
      s,
      {
        thread: key,
        sender: address,
        subject,
        body,
        url: m.webLink,
        at: m.receivedDateTime,
        confirmed,
        messageId: m.id,
      },
      config
    );
    return;
  }
  const sent = folder === 'sentitems';
  const parties = sent
    ? (m.toRecipients || []).map((x) => x.emailAddress?.address?.toLowerCase()).filter(Boolean)
    : [address];
  if (!parties.length || (!sent && address === box.toLowerCase())) return;
  const matches = s.all(
    `SELECT id FROM engagements WHERE line='media' AND stage NOT IN ('complete','dead')
    AND lower(json_extract(details,'$.contact_email')) IN (${parties.map(() => '?').join(',')})`,
    ...parties
  );
  if (!matches.length) return;
  const item = {
    kind: sent ? 'sent' : 'reply',
    title: subject.slice(0, 400) || 'Email',
    notes: body.slice(0, 5000),
    status: sent ? 'done' : 'waiting',
    external_ref: m.webLink || '',
    source_key: 'graph:' + digest(box.toLowerCase() + ':' + (m.internetMessageId || m.id)),
  };
  const at = (sent ? m.sentDateTime : m.receivedDateTime) || iso();
  if (s.get('SELECT 1 FROM unmatched_media_mail WHERE source_key=?', item.source_key)) return;
  if (s.get('SELECT 1 FROM work_items WHERE source_key=?', item.source_key)) return;
  if (matches.length === 1) {
    addItem(s, system, matches[0].id, item, at);
    return;
  }
  s.run(
    'INSERT INTO unmatched_media_mail(source_key,candidates,summary,occurred_at) VALUES(?,?,?,?)',
    item.source_key,
    JSON.stringify(matches.map((x) => x.id)),
    JSON.stringify(item),
    at
  );
}
export function reconcileMatch(s, actor, key, deal) {
  requireAdmin(actor);
  return s.tx(() => {
    const row = s.get('SELECT * FROM unmatched_media_mail WHERE source_key=?', key);
    if (!row || row.resolved_at) throw new AppError(409, 'This message has already been reviewed.');
    if (deal && !JSON.parse(row.candidates).includes(deal))
      throw new AppError(400, 'Choose a matching engagement.');
    if (deal) addItem(s, actor, deal, JSON.parse(row.summary), row.occurred_at);
    s.run(
      'UPDATE unmatched_media_mail SET resolved_at=?,engagement_id=? WHERE source_key=?',
      iso(),
      deal || null,
      key
    );
    audit(s, actor, 'media.mail_reviewed', 'engagement', deal || null);
    return { ok: true };
  });
}
export async function pollFolder(s, config, token, stream, box, folder, request) {
  const key = stream + ':' + box.toLowerCase() + ':' + folder;
  const existing = s.get('SELECT cursor,watermark FROM mailbox_state WHERE stream=?', key);
  const first = new URL(userPath(box) + '/mailFolders/' + folder + '/messages/delta');
  first.searchParams.set(
    '$select',
    'id,subject,from,toRecipients,bodyPreview,conversationId,receivedDateTime,sentDateTime,isDraft,internetMessageId,internetMessageHeaders,webLink'
  );
  // Activation starts from now so historical messages never receive a surprise acknowledgement.
  const watermark = existing?.watermark || iso();
  first.searchParams.set('$filter', 'receivedDateTime ge ' + watermark);
  if (!existing) s.run('INSERT INTO mailbox_state VALUES(?,?,?)', key, first.href, watermark);
  const url = existing?.cursor || first.href;
  if (new URL(url).origin !== 'https://graph.microsoft.com') throw new Error('Unexpected Graph cursor origin.');
  const r = await request(url, {
    headers: { Authorization: 'Bearer ' + token, Prefer: 'odata.maxpagesize=50, IdType="ImmutableId"' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (r.status === 410) {
    s.run('UPDATE mailbox_state SET cursor=? WHERE stream=?', first.href, key);
    return;
  }
  if (!r.ok) throw new Error('Graph mailbox returned HTTP ' + r.status);
  const data = await r.json(),
    next = data['@odata.nextLink'] || data['@odata.deltaLink'];
  if (!next || new URL(next).origin !== 'https://graph.microsoft.com')
    throw new Error('Missing Graph delta cursor.');
  for (const m of data.value || []) classifyMessage(s, config, { stream, box, folder }, m);
  const latest = (data.value || [])
    .map((m) => m.receivedDateTime)
    .filter((v) => typeof v === 'string' && Number.isFinite(Date.parse(v)))
    .sort()
    .at(-1);
  const resume = latest
    ? new Date(Math.max(Date.parse(watermark), Date.parse(latest) - 86400000)).toISOString()
    : watermark;
  s.run('UPDATE mailbox_state SET cursor=?,watermark=? WHERE stream=?', next, resume, key);
}
export async function drainMail(s, config, token, request = fetch) {
  const mode = config.mail;
  for (const d of s.all(
    "SELECT * FROM dispatches WHERE status='queued' AND try_after<=? AND (recipient<>'' OR ?<>'') ORDER BY created_at LIMIT 30",
    Date.now(),
    config.accountingEmail || ''
  )) {
    const to =
      d.recipient || (['agreement_signed', 'billing_completed'].includes(d.kind) ? config.accountingEmail : '');
    if (!to) continue;
    let body = d.body;
    if (d.kind==='team_invite') {
      const value=invitationToken(config.linkSecret,d.id);
      const valid=s.get('SELECT 1 FROM setup_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>? AND u.enabled=1 AND u.email=?',digest(value),Date.now(),to);
      if (!valid) {
        s.run("UPDATE dispatches SET status='cancelled',detail='Invitation expired or replaced.' WHERE id=? AND status='queued'",d.id);
        continue;
      }
      body+='\n\n'+new URL('/setup/'+value,config.origin).href;
    }
    if(d.kind==='client_intake') {
      const publicId=d.dedupe_key.split(':')[1],value=formToken(publicId,config.linkSecret);
      if(!s.get('SELECT 1 FROM form_links WHERE token_hash=? AND revoked=0 AND submission_id IS NULL AND expires_at>?',digest(value),Date.now())) {
        s.run("UPDATE dispatches SET status='cancelled',detail='Intake link expired, revoked or completed.' WHERE id=? AND status='queued'",d.id);
        continue;
      }
      body+='\n\n'+new URL('/onboard/'+value,config.origin).href;
    }
    const attachments = [];
    let remaining = 2 * 1024 * 1024;
    if (['agreement_signed', 'billing_completed'].includes(d.kind))
      for (const f of s.all(
        "SELECT id,name,mime,length(bytes) size FROM attachments WHERE engagement_id=? AND purpose='agreement' ORDER BY created_at DESC",
        d.engagement_id
      )) {
        if (f.size <= remaining) {
          attachments.push({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: f.name,
            contentType: f.mime,
            contentBytes: Buffer.from(s.get('SELECT bytes FROM attachments WHERE id=?', f.id).bytes).toString(
              'base64'
            ),
          });
          remaining -= f.size;
        } else body += '\n\n' + f.name + '\n' + accountingFileUrl(config, f.id);
      }
    const mailbox = d.kind === 'guest_ack' ? mode.podcast : mode.sender;
    if (!mailbox) continue;
    if (
      !s.run(
        "UPDATE dispatches SET status='sending',attempted_at=? WHERE id=? AND status='queued'",
        iso(),
        d.id
      ).changes
    )
      continue;
    let status = 'check_delivery',
      detail = 'Check Sent Items before retrying.',
      retryAt = 0;
    try {
      const messageId =
        d.kind === 'guest_ack'
          ? s.get('SELECT message_id FROM guest_pitches WHERE id=?', d.pitch_id)?.message_id
          : null;
      const path = messageId ? '/messages/' + encodeURIComponent(messageId) + '/reply' : '/sendMail';
      const packet = messageId
        ? { comment: body }
        : {
            message: {
              subject: d.subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }],
              attachments,
            },
            saveToSentItems: true,
          };
      const r = await request(userPath(mailbox) + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Prefer: 'IdType="ImmutableId"',
        },
        redirect: 'error',
        body: JSON.stringify(packet),
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 202) {
        status = 'accepted';
        detail = 'Accepted by Microsoft 365.';
      } else if (r.status === 429) {
        status = 'queued';
        detail = 'Microsoft 365 rate limit.';
        const delay = r.headers.get('Retry-After') || '60';
        retryAt = /^\d+$/.test(delay)
          ? Date.now() + Math.min(86400, Number(delay)) * 1000
          : Date.parse(delay) || Date.now() + 60000;
      } else if (r.status >= 400 && r.status < 500) {
        status = 'failed';
        detail = 'Microsoft 365 returned HTTP ' + r.status;
      }
    } catch {
      // A network failure after handoff may have delivered the message.
    }
    s.tx(() => {
      s.run(
        'UPDATE dispatches SET status=?,detail=?,recipient=?,try_after=? WHERE id=?',
        status,
        detail,
        to,
        retryAt,
        d.id
      );
      if (d.report_id && status === 'accepted')
        s.run("UPDATE report_versions SET status='sent',sent_at=coalesce(sent_at,?) WHERE id=?", iso(),d.report_id);
    });
    if (status === 'queued') break;
  }
}
export function resolveMail(s, key, decision) {
  if (!['retry', 'confirmed_sent'].includes(decision)) throw new AppError(400, 'Choose a delivery decision.');
  return s.tx(() => {
    const d = s.get('SELECT * FROM dispatches WHERE id=?', key);
    if (!d || !['check_delivery', 'failed'].includes(d.status))
      throw new AppError(409, 'This message does not need reconciliation.');
    s.run(
      'UPDATE dispatches SET status=?,detail=? WHERE id=?',
      decision === 'retry' ? 'queued' : 'accepted',
      'Reconciled by admin.',
      key
    );
    if (d.report_id && decision === 'confirmed_sent')
      s.run("UPDATE report_versions SET status='sent',sent_at=coalesce(sent_at,?) WHERE id=?", iso(),d.report_id);
    return { ok: true };
  });
}
export function startMail(s, config, request = fetch) {
  if (!ready(config)) return () => {};
  s.run(
    "UPDATE dispatches SET status='check_delivery',detail='Interrupted delivery. Check Sent Items.' WHERE status='sending'"
  );
  let busy = false,
    closed = false;
  async function tick() {
    if (busy || closed) return;
    busy = true;
    try {
      const t = await tokenFor(config.mail, request);
      for (const [type, box, folder] of [
        ['podcast', config.mail.podcast, 'inbox'],
        ['media', config.mail.media, 'inbox'],
        ['media', config.mail.media, 'sentitems'],
      ]) {
        if (!box || closed) continue;
        try {
          await pollFolder(s, config, t, type, box, folder, request);
        } catch (error) {
          console.error('Mailbox sync:', error.message);
        }
      }
      if (!closed) await drainMail(s, config, t, request);
    } catch (error) {
      console.error('Mail sync:', error.message);
    } finally {
      busy = false;
    }
  }
  void tick();
  const timer = setInterval(tick, 60000).unref();
  return () => {
    closed = true;
    clearInterval(timer);
  };
}
