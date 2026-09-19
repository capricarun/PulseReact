// Build verification tests. Run after `npm run build`:  npm test
// They prove the production bundle exists and calls the API through the same-origin /api path
// (nginx forwards /api to the backend), instead of a hardcoded localhost URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const assetsDir = new URL('assets/', dist);

const readBundle = () =>
  readdirSync(assetsDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => readFileSync(new URL(file, assetsDir), 'utf8'))
    .join('\n');

test('production build produced index.html', () => {
  assert.ok(existsSync(new URL('index.html', dist)), 'dist/index.html is missing - run npm run build first');
});

test('index.html loads a fingerprinted JS bundle and mounts #root', () => {
  const html = readFileSync(new URL('index.html', dist), 'utf8');
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="module" crossorigin src="\/assets\/index-[\w-]+\.js"><\/script>/);
});

test('bundle uses the same-origin /api base URL', () => {
  const js = readBundle();
  assert.ok(js.includes('"/api"'), 'VITE_API_URL=/api was not baked into the bundle');
  assert.ok(!js.includes('localhost:4000'), 'bundle still points at localhost:4000');
});
