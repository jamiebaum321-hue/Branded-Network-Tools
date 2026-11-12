import { createHandler } from '../server/app.mjs';
import { configuration } from '../server/config.mjs';
import { bootstrapFromEnv } from '../server/accounts.mjs';
import { openStore } from '../server/store.mjs';

// One pool and handler per function instance; the schema migration runs once on cold start.
let ready;
function load() {
  ready ??= (async () => {
    const config = configuration(process.env);
    const store = await openStore(config.database);
    await bootstrapFromEnv(store, process.env);
    return createHandler(store, config);
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}

export default async function handler(req, res) {
  let handle;
  try { handle = await load(); } catch (error) {
    console.error('Startup failed:', error.message);
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'The app is not configured yet. Check the server environment settings.' }));
    return;
  }
  return handle(req, res);
}
