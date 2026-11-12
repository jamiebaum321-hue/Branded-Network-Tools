import { randomBytes } from 'node:crypto';

function webUrl(value, label, https = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Set a valid ${label}.`); }
  if (!['http:', 'https:'].includes(url.protocol) || (https && url.protocol !== 'https:') || url.username || url.password || url.hash) {
    throw new Error(`Set a valid ${https ? 'HTTPS ' : ''}${label}.`);
  }
  return url;
}

export function configuration(env, { demo = false } = {}) {
  const production = env.NODE_ENV === 'production';
  if (demo && production) throw new Error('The demo is only available locally.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid PORT.');
  const host = demo ? '127.0.0.1' : (env.HOST || '127.0.0.1');
  const origin = webUrl(demo ? `http://127.0.0.1:${port}` : env.APP_ORIGIN || (production ? '' : `http://127.0.0.1:${port}`), 'APP_ORIGIN', production);
  if (origin.pathname !== '/' || origin.search) throw new Error('APP_ORIGIN must be an origin without a path.');
  const database = demo ? ':memory:' : env.DATABASE_PATH;
  if (!database || (production && database === ':memory:')) throw new Error('Set DATABASE_PATH to a durable database file.');
  const linkSecret = demo ? randomBytes(32).toString('hex') : env.LINK_SECRET;
  if (!linkSecret || linkSecret.length < 32) throw new Error('Set LINK_SECRET to a securely generated secret of at least 32 characters.');
  const timeZone = env.WORKSPACE_TIME_ZONE || 'America/New_York';
  new Intl.DateTimeFormat('en', { timeZone });
  let oauth = null;
  const oauthValues = [env.MCP_ISSUER, env.MCP_INTROSPECTION_URL, env.MCP_INTROSPECTION_CLIENT_ID, env.MCP_INTROSPECTION_CLIENT_SECRET];
  if (!demo && oauthValues.some(Boolean)) {
    if (oauthValues.some(value => !value)) throw new Error('Configure all four MCP OAuth settings together.');
    const issuer = webUrl(env.MCP_ISSUER, 'MCP_ISSUER', true);
    if (issuer.search) throw new Error('MCP_ISSUER must not have a query.');
    oauth = { issuer: env.MCP_ISSUER, introspection: webUrl(env.MCP_INTROSPECTION_URL, 'MCP_INTROSPECTION_URL', true),
      clientId: env.MCP_INTROSPECTION_CLIENT_ID, secret: env.MCP_INTROSPECTION_CLIENT_SECRET };
  }
  const mcpOrigins = new Set([origin.origin]);
  for (const allowed of (env.MCP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = webUrl(allowed, 'MCP_ALLOWED_ORIGINS', production);
    if (url.pathname !== '/' || url.search) throw new Error('MCP_ALLOWED_ORIGINS must contain only origins.');
    mcpOrigins.add(url.origin);
  }
  return { production, demo, port, host, origin, database, linkSecret, timeZone, oauth, mcpOrigins,
    pdfPython: env.PDF_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), pdfFont: env.PDF_FONT_PATH };
}
