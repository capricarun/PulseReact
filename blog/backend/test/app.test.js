// API tests that run without a database. Infrastructure tests (probes, metrics, errors) use an
// unreachable MySQL; feature tests replace pool.query with a small fake so every route is exercised.
// Run with: npm test   (built-in Node.js test runner, no extra dependencies)
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = 'unit-test-secret-not-used-anywhere-else';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1'; // nothing listens on port 1, so real DB calls fail fast
process.env.DB_USER = 'unit_test';
process.env.DB_NAME = 'unit_test';

const app = require('../server');
const pool = require('../src/config/db');

const realQuery = pool.query.bind(pool);
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  pool.query = realQuery;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end().catch(() => {});
});

// Replaces pool.query: each rule is [regex, result or (params) => result]; records every call.
function fakeDb(rules) {
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    const rule = rules.find(([pattern]) => pattern.test(sql));
    if (!rule) throw new Error(`unexpected query: ${sql}`);
    const result = typeof rule[1] === 'function' ? rule[1](params) : rule[1];
    return [result, []];
  };
  return calls;
}

const tokenFor = (user = { id: 7, name: 'Ada', email: 'ada@example.com' }) =>
  jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '5m' });

const request = (method, path, body, headers = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (path, headers) => request('GET', path, undefined, headers);
const post = (path, body, headers) => request('POST', path, body, headers);
const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const PUBLISHED = {
  id: 3, title: 'Hello', slug: 'hello-abc123', body: 'x'.repeat(40), status: 'published', author_id: 1, author_name: 'Ada',
};
const DRAFT = { ...PUBLISHED, id: 4, slug: 'secret-draft', status: 'draft', author_id: 7 };

// ---------- probes, metrics, errors ----------

test('GET /api/health returns ok (liveness)', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /api/ready returns 503 when the database is unreachable (readiness)', async () => {
  const res = await get('/api/ready');
  assert.equal(res.status, 503);
  assert.equal((await res.json()).status, 'unavailable');
});

test('GET /api/ready returns 200 when the database answers', async () => {
  fakeDb([[/SELECT 1/, [{ 1: 1 }]]]);
  const res = await get('/api/ready');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ready' });
});

test('security headers are set and x-powered-by is hidden', async () => {
  const res = await get('/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('unknown routes return a JSON 404', async () => {
  const res = await get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('database errors are hidden behind a generic 500', async () => {
  const res = await get('/api/posts');
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Internal server error' });
});

test('malformed JSON is rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email":',
  });
  assert.equal(res.status, 400);
});

test('GET /metrics exposes Prometheus metrics with route labels', async () => {
  await get('/api/health');
  const res = await get('/metrics');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /blog_http_requests_total\{.*route="\/api\/health".*\}/);
  assert.match(body, /blog_http_request_duration_seconds_bucket/);
  assert.match(body, /process_cpu_user_seconds_total/);
});

// ---------- auth ----------

test('register validates the name', async () => {
  const res = await post('/api/auth/register', { name: 'x', email: 'user@example.com', password: 'longenough' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Name must be 2-120 characters');
});

test('register validates the password length', async () => {
  const res = await post('/api/auth/register', { name: 'Valid User', email: 'user@example.com', password: 'short' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Password must be at least 8 characters');
});

test('register creates the user, hashes the password and returns a token', async () => {
  const calls = fakeDb([
    [/SELECT id FROM users/, []],
    [/INSERT INTO users/, { insertId: 42 }],
  ]);
  const res = await post('/api/auth/register', { name: 'New Writer', email: 'New@Example.com', password: 'longenough' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.user, { id: 42, name: 'New Writer', email: 'new@example.com' });
  assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).id, 42);
  const hash = calls[1].params.passwordHash;
  assert.notEqual(hash, 'longenough');
  assert.ok(await bcrypt.compare('longenough', hash));
});

test('register rejects an email that is already taken', async () => {
  fakeDb([[/SELECT id FROM users/, [{ id: 1 }]]]);
  const res = await post('/api/auth/register', { name: 'Twice', email: 'taken@example.com', password: 'longenough' });
  assert.equal(res.status, 409);
});

test('register passes database failures to the error handler', async () => {
  const res = await post('/api/auth/register', { name: 'No Db', email: 'nodb@example.com', password: 'longenough' });
  assert.equal(res.status, 500);
});

test('login validates the email', async () => {
  const res = await post('/api/auth/login', { email: 'not-an-email', password: 'whatever' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Enter a valid email');
});

test('login returns a token for the right password', async () => {
  const passwordHash = await bcrypt.hash('correct horse', 4);
  fakeDb([[/FROM users WHERE email/, [{ id: 5, name: 'Ada', email: 'ada@example.com', password_hash: passwordHash }]]]);
  const res = await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.id, 5);
  assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).email, 'ada@example.com');
});

test('login gives the same answer for a wrong password and an unknown email', async () => {
  const passwordHash = await bcrypt.hash('correct horse', 4);
  fakeDb([[/FROM users WHERE email = :email/, (p) => (p.email === 'ada@example.com'
    ? [{ id: 5, name: 'Ada', email: p.email, password_hash: passwordHash }] : [])]]);
  const wrong = await post('/api/auth/login', { email: 'ada@example.com', password: 'wrong password' });
  const unknown = await post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
});

test('login passes database failures to the error handler', async () => {
  const res = await post('/api/auth/login', { email: 'ada@example.com', password: 'whatever' });
  assert.equal(res.status, 500);
});

// ---------- posts: reading ----------

test('the post list returns published posts with paging info', async () => {
  const calls = fakeDb([
    [/SELECT COUNT/, [{ total: 11 }]],
    [/FROM posts p JOIN users/, [PUBLISHED]],
  ]);
  const res = await get('/api/posts?page=2&limit=5');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data[0].slug, PUBLISHED.slug);
  assert.deepEqual([body.page, body.limit, body.total, body.totalPages], [2, 5, 11, 3]);
  assert.equal(calls[0].params.offset, 5);
  assert.match(calls[0].sql, /p\.status = 'published'/);
});

test('the post list filters by tag and search, and clamps paging', async () => {
  const calls = fakeDb([
    [/SELECT COUNT/, [{ total: 0 }]],
    [/FROM posts p JOIN users/, []],
  ]);
  const res = await get('/api/posts?tag=devops&search=eks&page=-3&limit=999');
  const body = await res.json();
  assert.equal(body.page, 1);
  assert.equal(body.limit, 50);
  assert.deepEqual(
    { tag: calls[0].params.tag, search: calls[0].params.search },
    { tag: 'devops', search: '%eks%' }
  );
});

test('a published post is returned with its comments', async () => {
  fakeDb([
    [/FROM posts p JOIN users u ON u.id = p.author_id\s+WHERE p.slug/, [PUBLISHED]],
    [/FROM comments/, [{ id: 1, body: 'Nice', author_name: 'Bob' }]],
  ]);
  const res = await get(`/api/posts/${PUBLISHED.slug}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, 'Hello');
  assert.equal(body.comments.length, 1);
});

test('an unknown slug returns 404', async () => {
  fakeDb([[/WHERE p.slug/, []]]);
  const res = await get('/api/posts/nope');
  assert.equal(res.status, 404);
});

test('a draft is hidden from visitors and other users, but visible to its author', async () => {
  fakeDb([
    [/WHERE p.slug/, [DRAFT]],
    [/FROM comments/, []],
  ]);
  assert.equal((await get(`/api/posts/${DRAFT.slug}`)).status, 404);
  assert.equal((await get(`/api/posts/${DRAFT.slug}`, auth({ id: 99, name: 'Other' }))).status, 404);
  assert.equal((await get(`/api/posts/${DRAFT.slug}`, { Authorization: 'Bearer garbage' })).status, 404);
  const own = await get(`/api/posts/${DRAFT.slug}`, auth());
  assert.equal(own.status, 200);
  assert.equal((await own.json()).status, 'draft');
});

test('reading a post passes database failures to the error handler', async () => {
  const res = await get('/api/posts/any-slug');
  assert.equal(res.status, 500);
});

// ---------- posts: writing ----------

test('creating a post requires a token', async () => {
  const res = await post('/api/posts', { title: 'Hello', body: 'x'.repeat(30) });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Authentication required');
});

test('creating a post rejects an invalid token', async () => {
  const res = await post('/api/posts', { title: 'Hello' }, { Authorization: 'Bearer not-a-real-token' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Invalid or expired token');
});

test('creating a post validates the body before touching the database', async () => {
  const res = await post('/api/posts', { title: 'Hello there', body: 'too short' }, auth());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Body must be at least 20 characters');
});

test('creating a post rejects a non-https cover image', async () => {
  const res = await post(
    '/api/posts',
    { title: 'Hello there', body: 'x'.repeat(30), coverImage: 'javascript:alert(1)' },
    auth()
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Cover image must be an https URL');
});

test('creating a post stores it with a slug, excerpt and reading time', async () => {
  const calls = fakeDb([[/INSERT INTO posts/, { insertId: 12 }]]);
  const text = Array.from({ length: 450 }, (_, i) => `word${i}`).join(' ');
  const res = await post('/api/posts', { title: 'Shipping to EKS!', body: text, tag: 'DevOps' }, auth());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.id, 12);
  assert.match(body.slug, /^shipping-to-eks-[0-9a-f]{6}$/);
  const p = calls[0].params;
  assert.equal(p.authorId, 7);
  assert.equal(p.tag, 'devops');
  assert.equal(p.status, 'published');
  assert.equal(p.readMinutes, 2);
  assert.ok(p.excerpt.length <= 160 && p.excerpt.endsWith('…'));
});

test('creating a draft keeps the given excerpt and status', async () => {
  const calls = fakeDb([[/INSERT INTO posts/, { insertId: 13 }]]);
  const res = await post(
    '/api/posts',
    { title: '!!!', body: 'A short but valid body text.', excerpt: 'Custom', status: 'draft' },
    auth()
  );
  assert.equal(res.status, 201);
  assert.match((await res.json()).slug, /^post-[0-9a-f]{6}$/);
  assert.deepEqual([calls[0].params.excerpt, calls[0].params.status, calls[0].params.tag], ['Custom', 'draft', 'general']);
});

test('creating a post passes database failures to the error handler', async () => {
  const res = await post('/api/posts', { title: 'Hello there', body: 'x'.repeat(30) }, auth());
  assert.equal(res.status, 500);
});

// ---------- comments ----------

test('commenting requires a token and a non-empty body', async () => {
  assert.equal((await post('/api/posts/hello/comments', { body: 'hi' })).status, 401);
  const res = await post('/api/posts/hello/comments', { body: '   ' }, auth());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Comment must be 1-1000 characters');
});

test('commenting on a published post stores the comment', async () => {
  const calls = fakeDb([
    [/SELECT id, status, author_id FROM posts/, [PUBLISHED]],
    [/INSERT INTO comments/, { insertId: 9 }],
  ]);
  const res = await post(`/api/posts/${PUBLISHED.slug}/comments`, { body: 'Great read' }, auth());
  assert.equal(res.status, 201);
  assert.equal((await res.json()).id, 9);
  assert.deepEqual(calls[1].params, { postId: 3, authorId: 7, body: 'Great read' });
});

test('commenting on a missing post, or someone else\'s draft, returns 404', async () => {
  fakeDb([[/SELECT id, status, author_id FROM posts/, (p) => (p.slug === DRAFT.slug ? [DRAFT] : [])]]);
  assert.equal((await post('/api/posts/nope/comments', { body: 'hi' }, auth())).status, 404);
  assert.equal((await post(`/api/posts/${DRAFT.slug}/comments`, { body: 'hi' }, auth({ id: 99 }))).status, 404);
});

test('commenting passes database failures to the error handler', async () => {
  const res = await post('/api/posts/hello/comments', { body: 'hi' }, auth());
  assert.equal(res.status, 500);
});
