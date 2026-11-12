import { backup } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootstrap } from './accounts.mjs';
import { configuration } from './config.mjs';
import { openStore } from './store.mjs';

try {
  const config = configuration(process.env);
  const [command, ...args] = process.argv.slice(2);
  if (!['bootstrap','backup'].includes(command)) throw new Error('Use admin:create or db:backup.');
  const store = openStore(config.database);
  try {
    if (command === 'bootstrap') {
      if (args.length !== 2) throw new Error('Usage: npm run admin:create -- "Full Name" name@example.com');
      const setup = bootstrap(store, ...args);
      console.log(`One-time setup link (expires in 24 hours): ${new URL(setup.path, config.origin).href}`);
    } else {
      if (args.length !== 1) throw new Error('Usage: npm run db:backup -- /path/to/new-backup.sqlite');
      const destination = resolve(args[0]);
      if (existsSync(destination)) throw new Error('Choose a new backup filename.');
      await backup(store.db, destination);
      if (process.platform !== 'win32') chmodSync(destination, 0o600);
      console.log(`Backup saved to ${destination}`);
    }
  } finally { store.db.close(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
