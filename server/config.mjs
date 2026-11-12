function webUrl(value, label, https = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Set a valid ${label}.`); }
  if (!['http:', 'https:'].includes(url.protocol) || (https && url.protocol !== 'https:') || url.username || url.password || url.hash) {
    throw new Error(`Set a valid ${https ? 'HTTPS ' : ''}${label}.`);
  }
  return url;
}

export function configuration(env) {
  const production = env.NODE_ENV === 'production';
  const vercel = Boolean(env.VERCEL);
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid PORT.');
  const host = env.HOST || '127.0.0.1';
  // On Vercel, fall back to the production domain (or a preview's branch domain) when APP_ORIGIN is not set.
  const vercelHost = env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  const fallback = vercel && vercelHost ? `https://${vercelHost}` : production ? '' : `http://127.0.0.1:${port}`;
  const origin = webUrl(env.APP_ORIGIN || fallback, 'APP_ORIGIN', production);
  if (origin.pathname !== '/' || origin.search) throw new Error('APP_ORIGIN must be an origin without a path.');
  const database = env.DATABASE_URL || env.POSTGRES_URL;
  if (!database) throw new Error('Set DATABASE_URL to the Postgres connection string.');
  const linkSecret = env.LINK_SECRET;
  if (!linkSecret || linkSecret.length < 32) throw new Error('Set LINK_SECRET to a securely generated secret of at least 32 characters.');
  const timeZone = env.WORKSPACE_TIME_ZONE || 'America/New_York';
  new Intl.DateTimeFormat('en', { timeZone });
  let oauth = null;
  const oauthValues = [env.MCP_ISSUER, env.MCP_INTROSPECTION_URL, env.MCP_INTROSPECTION_CLIENT_ID, env.MCP_INTROSPECTION_CLIENT_SECRET];
  if (oauthValues.some(Boolean)) {
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
  const cronSecret = env.CRON_SECRET || null;
  // Vercel's own deployment hostnames may serve the app too; writes still require the canonical Origin.
  const hosts = new Set([origin.host.toLowerCase(), ...(vercel ? [env.VERCEL_URL, env.VERCEL_BRANCH_URL] : [])
    .filter(Boolean).map(value => value.toLowerCase())]);
  return { production, vercel, trustProxy: vercel || env.TRUST_PROXY === '1', port, host, origin, database, linkSecret,
    timeZone, oauth, mcpOrigins, cronSecret, hosts,
    // Local development behind a preview proxy: accept any Host and same-host Origins. Never in production.
    anyHost: !production && env.ALLOW_ANY_HOST === '1' };
}
