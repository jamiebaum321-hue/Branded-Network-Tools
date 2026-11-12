import { bootstrap } from './accounts.mjs';
import { configuration } from './config.mjs';
import { openStore } from './store.mjs';

try {
  const config = configuration(process.env);
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'bootstrap') throw new Error('Use admin:create.');
  if (args.length !== 2) throw new Error('Usage: npm run admin:create -- "Full Name" name@example.com');
  const store = await openStore(config.database, { max: 1 });
  try {
    const setup = await bootstrap(store, ...args);
    console.log(`One-time setup link (expires in 24 hours): ${new URL(setup.path, config.origin).href}`);
  } finally { await store.close(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
