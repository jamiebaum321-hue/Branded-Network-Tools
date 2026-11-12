import { cleanExpired } from './accounts.mjs';
import { createApp } from './app.mjs';
import { configuration } from './config.mjs';
import { demoEmail, demoPassword, loadDemo } from './demo.mjs';
import { openStore } from './store.mjs';

const config = configuration(process.env, { demo: process.argv.includes('--demo') });
const store = openStore(config.database);
if (config.demo) await loadDemo(store);
cleanExpired(store);
const server = createApp(store, config);
const cleanup = setInterval(() => {
  try { cleanExpired(store); } catch (error) { console.error('Session cleanup failed:', error.code ?? error.name); }
}, 3600000).unref();

server.on('error', error => { console.error(`Could not start the app: ${error.code ?? error.message}`); process.exitCode = 1; });
server.listen(config.port, config.host, () => {
  console.log(`Branded Network Tools: ${config.origin.origin}`);
  if (config.demo) console.log(`Local demo: ${demoEmail} / ${demoPassword}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  clearInterval(cleanup);
  server.close(() => store.db.close());
  setTimeout(() => server.closeAllConnections(), 5000).unref();
});
