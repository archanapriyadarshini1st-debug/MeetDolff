/* global URL, console */
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const pages = ['popup', 'sidepanel', 'dashboard', 'settings', 'offscreen'];

for (const page of pages) {
  await cp(join(dist, 'src', page, `${page}.html`), join(dist, `${page}.html`));
}
await rm(join(dist, 'src'), { recursive: true, force: true });
console.log(`Packaged MV3 extension: ${pages.length} root HTML pages`);
