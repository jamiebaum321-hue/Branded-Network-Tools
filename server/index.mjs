import { bootstrapFromEnv, cleanExpired } from './accounts.mjs';
import { createApp } from './app.mjs';
import { configuration } from './config.mjs';
import { openStore } from './store.mjs';

const config = configuration(process.env);
const store = await openStore(config.database);
await bootstrapFromEnv(store, process.env);
await cleanExpired(store);
const server = createApp(store, config);
const cleanup = setInterval(() => {
  cleanExpired(store).catch(error => console.error('Session cleanup failed:', error.code ?? error.name));
}, 3600000).unref();

server.on('error', error => { console.error(`Could not start the app: ${error.code ?? error.message}`); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log(`Branded Network Tools: ${config.origin.origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  clearInterval(cleanup);
  server.close(() => store.close());
  setTimeout(() => server.closeAllConnections(), 5000).unref();
});
