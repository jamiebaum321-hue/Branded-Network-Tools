import { createHmac, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { AppError, audit, clientFor, id, iso, requireHuman } from './store.mjs';
import { getFormLink } from './clients.mjs';
import { engagement } from './engagements.mjs';
import { choice, object, str, validate } from './validation.mjs';

export const fileLimit = 5 * 1024 * 1024;
export const uploadLimit = Math.ceil((fileLimit * 4) / 3) + 8192;
const types = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const fields = 'id,name,mime,purpose,length(bytes) AS size,created_at,submission_id';
function decodeFile(input) {
  const data = validate(
    object({
      name: str(180),
      data: str(uploadLimit),
      purpose: choice('asset', 'logo', 'agreement', 'collateral'),
    }),
    input
  );
  const name = data.name.replace(/[\\/:"<>|?*\x00-\x1f\x7f]/g, '_');
  const ext = extname(name).slice(1).toLowerCase(),
    mime = types[ext];
  if (
    !mime ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.data.slice(-8)) ||
    data.data.length % 4 !== 0
  )
    throw new AppError(400, 'Choose a supported document or image.');
  const bytes = Buffer.from(data.data, 'base64');
  if (!bytes.length || bytes.length > fileLimit || bytes.toString('base64') !== data.data)
    throw new AppError(400, 'Each file must be valid and at most 5 MiB.');
  const prefix = bytes.subarray(0, 600).toString('utf8');
  const matches = {
    pdf: prefix.startsWith('%PDF-'),
    xlsx: bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
    xls: bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')),
    png: bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    jpg: bytes[0] === 255 && bytes[1] === 216,
    webp: prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP',
    svg: /<svg[\s>]/i.test(prefix),
    csv: !bytes.includes(0),
  };
  if (!matches[ext === 'jpeg' ? 'jpg' : ext])
    throw new AppError(400, 'The file content does not match its extension.');
  if (data.purpose === 'logo' && !mime.startsWith('image/'))
    throw new AppError(400, 'Choose an image for the logo.');
  return { name, mime, bytes, purpose: data.purpose };
}
function insert(s, data, { client = null, deal = null, form = null }) {
  const f = decodeFile(data);
  const used = s.get(
    'SELECT count(*) n,coalesce(sum(length(bytes)),0) total FROM attachments WHERE form_key=? OR engagement_id=?',
    form,
    deal
  );
  if (used.n >= 32 || used.total + f.bytes.length > 50 * 1024 * 1024)
    throw new AppError(413, 'This record has reached its upload allowance.');
  const key = id();
  s.run(
    'INSERT INTO attachments(id,client_id,engagement_id,form_key,purpose,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    key,
    client,
    deal,
    form,
    f.purpose,
    f.name,
    f.mime,
    f.bytes,
    iso()
  );
  return { id: key, name: f.name, purpose: f.purpose };
}
export function intakeUpload(s, token, data, config) {
  return s.tx(() => {
    const f = getFormLink(s, token, config.linkSecret);
    if (f.submission_id) throw new AppError(409, 'This intake has already been submitted.');
    if (!['logo', 'asset'].includes(data?.purpose))
      throw new AppError(400, 'Choose a logo or supporting asset.');
    return insert(s, data, { client: f.client_id, form: f.token_hash });
  });
}
export function dealUpload(s, a, key, data) {
  requireHuman(a);
  const e = engagement(s, a, key);
  return s.tx(() => {
    const file = insert(s, data, { deal: key, client: e.client_id });
    audit(s, a, 'file.added', 'attachment', file.id, e.client_id);
    return file;
  });
}
export function filesFor(s, deal) {
  return s.all(
    `SELECT ${fields} FROM attachments WHERE engagement_id=? OR (client_id=? AND submission_id IS NOT NULL) ORDER BY created_at DESC`,
    deal.id,
    deal.client_id
  );
}
export function authorizedFile(s, a, key) {
  const file = s.get(`SELECT ${fields},engagement_id,client_id FROM attachments WHERE id=?`, key);
  if (!file) throw new AppError(404, 'File not found.');
  if (file.engagement_id) engagement(s, a, file.engagement_id);
  else {
    if (!file.submission_id) throw new AppError(404, 'File not submitted.');
    clientFor(s, a, file.client_id);
  }
  return { ...file, bytes: Buffer.from(s.get('SELECT bytes FROM attachments WHERE id=?', key).bytes) };
}
export function sendFile(res, f, preview = false) {
  res.writeHead(200, {
    'Content-Type': f.mime,
    'Content-Disposition':
      (preview && f.mime.startsWith('image/') ? 'inline' : 'attachment') +
      "; filename*=UTF-8''" +
      encodeURIComponent(f.name).replace(/'/g, '%27'),
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': f.bytes.length,
  });
  res.end(f.bytes);
}
const signature = (secret, key, until) =>
  createHmac('sha256', secret)
    .update('accounting-file:' + key + ':' + until)
    .digest('base64url');
export function accountingFileUrl(config, key, now = Date.now()) {
  const until = Math.floor(now / 1000) + 14 * 86400;
  return new URL(
    '/api/accounting-file/' + key + '?until=' + until + '&sig=' + signature(config.linkSecret, key, until),
    config.origin
  ).href;
}
export function billingDownload(s, config, key, url) {
  const until = url.searchParams.get('until') || '',
    sig = url.searchParams.get('sig') || '';
  const expected = signature(config.linkSecret, key, until);
  if (
    !/^\d{10}$/.test(until) ||
    Number(until) * 1000 < Date.now() ||
    !/^[\w-]{43}$/.test(sig) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  )
    throw new AppError(404, 'This accounting link is unavailable.');
  const f = s.get("SELECT name,mime,bytes FROM attachments WHERE id=? AND purpose='agreement'", key);
  if (!f) throw new AppError(404, 'File not found.');
  return { ...f, bytes: Buffer.from(f.bytes) };
}
