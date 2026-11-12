// Copies the browser assets for Vercel's CDN. The HTML shell stays in the function so it gets
// the share-image URL and security headers.
import { cpSync, rmSync } from 'node:fs';

const out = new URL('../.vercel-static/', import.meta.url);
rmSync(out, { recursive: true, force: true });
cpSync(new URL('../public/', import.meta.url), out, { recursive: true, filter: source => !source.endsWith('index.html') });
console.log('Static assets ready.');
