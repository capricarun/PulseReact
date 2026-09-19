// API tests that run without a database: they cover routing, validation, auth, probes, metrics and error handling.
// Run with: npm test   (uses the built-in Node.js test runner, no extra dependencies)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'unit-test-secret-not-used-anywhere-else';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1'; // nothing listens on port 1, so every DB call fails fast
process.env.DB_USER = 'unit_test';
process.env.DB_NAME = 'unit_test';

const app = require('../server');
const pool = require('../src/config/db');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end().catch(() => {});
});

const post = (path, body, headers = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('GET /api/health returns ok (liveness)', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /api/ready returns 503 when the database is unreachable (readiness)', async () => {
  const res = await fetch(`${baseUrl}/api/ready`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, 'unavailable');
});

test('security headers are set and x-powered-by is hidden', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('unknown routes return a JSON 404', async () => {
  const res = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('register validates the username', async () => {
  const res = await post('/api/auth/register', {
    username: 'x',
    email: 'user@example.com',
    password: 'longenough',
    displayName: 'User',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Username must be 3-30 characters');
});

test('register validates the password length', async () => {
  const res = await post('/api/auth/register', {
    username: 'valid_user',
    email: 'user@example.com',
    password: 'short',
    displayName: 'User',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Password must be at least 8 characters');
});

test('login validates the email', async () => {
  const res = await post('/api/auth/login', { email: 'not-an-email', password: 'whatever' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Enter a valid email');
});

test('creating a post requires a token', async () => {
  const res = await post('/api/posts', { content: 'hello #world' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Authentication required');
});

test('creating a post rejects an invalid token', async () => {
  const res = await post('/api/posts', { content: 'hello' }, { Authorization: 'Bearer not-a-real-token' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Invalid or expired token');
});

test('creating a post validates the content before touching the database', async () => {
  const token = jwt.sign({ id: 1, username: 'tester' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const res = await post('/api/posts', { content: '   ' }, { Authorization: `Bearer ${token}` });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Post must be 1-500 characters');
});

test('liking a post requires a token', async () => {
  const res = await post('/api/posts/1/like', {});
  assert.equal(res.status, 401);
});

test('database errors are hidden behind a generic 500', async () => {
  const res = await fetch(`${baseUrl}/api/posts`, { headers: { Authorization: 'Bearer invalid' } });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Internal server error' });
});

test('GET /metrics exposes Prometheus metrics with route labels', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /pulse_http_requests_total\{.*route="\/api\/health".*\}/);
  assert.match(body, /pulse_http_request_duration_seconds_bucket/);
  assert.match(body, /process_cpu_user_seconds_total/);
});
