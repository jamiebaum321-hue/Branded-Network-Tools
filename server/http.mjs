import { AppError } from './store.mjs';

export function json(res, status, value, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length,
    'Cache-Control': 'no-store', ...headers });
  res.end(bytes);
}

export function empty(res, status, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function readJson(req, limit = 262144) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    req.resume();
    throw new AppError(415, 'Use application/json.');
  }
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new AppError(413, 'The request is too large.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= limit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (bytes > limit) return reject(new AppError(413, 'The request is too large.'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AppError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new AppError(400, 'Request interrupted.')));
  });
}

export function protect(res, config) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function sameHostOrigin(req) {
  try {
    const host = (req.headers['x-forwarded-host'] ?? req.headers.host)?.split(',')[0].trim().toLowerCase();
    return Boolean(host) && new URL(req.headers.origin).host.toLowerCase() === host;
  } catch { return false; }
}

export function assertWebOrigin(req, config) {
  if (req.headers.origin !== config.origin.origin && !(config.anyHost && sameHostOrigin(req))) {
    req.resume();
    throw new AppError(403, 'This request must come from the app.');
  }
}

const cookieName = (config) => config.origin.protocol === 'https:' ? '__Host-branded_session' : 'branded_session';

export function readSession(req, config) {
  const prefix = `${cookieName(config)}=`;
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length);
}

export function sessionCookie(config, value, maxAge) {
  return `${cookieName(config)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.origin.protocol === 'https:' ? '; Secure' : ''}`;
}

// Vercel replaces X-Forwarded-For with the real client address; elsewhere only trust it when configured.
export function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}
