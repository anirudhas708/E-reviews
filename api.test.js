'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { start } = require('../src/server');

let app;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ereviews-test-'));
  app = await start({
    port: 0,
    dataDir: tmp,
    dbPath: ':memory:',
    logRequests: false,
    adminEmail: 'admin@test.com',
    adminPassword: 'Admin1234',
    rateLimits: { loginMax: 1000, registerMax: 1000 },
  });
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Tiny client that keeps its own cookie, like one browser. */
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  };
}

const goodReview = {
  company_name: 'Acme Corp',
  product_purchased: 'Acme Blender 3000',
  purchase_date: '2026-10-01',
  reviewer_name: 'Asha Rao',
  price: '4999.50',
  currency: 'INR',
  rating: 4,
  review_text: 'Works really well, quiet motor and easy to clean after use.',
};

async function registeredUser(email) {
  const c = client();
  const reg = await c('POST', '/api/auth/register', { name: 'Test User', email, password: 'Passw0rd1', confirmPassword: 'Passw0rd1' });
  assert.equal(reg.status, 201);
  const login = await c('POST', '/api/auth/login', { email, password: 'Passw0rd1' });
  assert.equal(login.status, 200);
  return c;
}

async function adminClient() {
  const c = client();
  const login = await c('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Admin1234' });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.role, 'admin');
  return c;
}

test('registration validates input and rejects duplicates', async () => {
  const c = client();
  const bad = await c('POST', '/api/auth/register', { name: 'A', email: 'nope', password: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.fields.name && bad.json.error.fields.email && bad.json.error.fields.password);

  const mismatch = await c('POST', '/api/auth/register', { name: 'Dup User', email: 'dup@test.com', password: 'Passw0rd1', confirmPassword: 'Different1' });
  assert.equal(mismatch.status, 400);
  assert.ok(mismatch.json.error.fields.confirmPassword);

  const ok = await c('POST', '/api/auth/register', { name: 'Dup User', email: 'dup@test.com', password: 'Passw0rd1' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.user.role, 'user');
  assert.equal(ok.headers.get('set-cookie'), null, 'registering must not log the user in');

  const again = await c('POST', '/api/auth/register', { name: 'Dup User', email: 'DUP@test.com', password: 'Passw0rd1' });
  assert.equal(again.status, 400);
  assert.match(again.json.error.fields.email, /already exists/);
});

test('cannot register as admin by sending a role', async () => {
  const c = client();
  const res = await c('POST', '/api/auth/register', { name: 'Sneaky', email: 'sneaky@test.com', password: 'Passw0rd1', role: 'admin' });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.role, 'user');
  const login = await c('POST', '/api/auth/login', { email: 'sneaky@test.com', password: 'Passw0rd1' });
  assert.equal(login.json.user.role, 'user');
  assert.equal((await c('GET', '/api/admin/reviews')).status, 403);
});

test('login: wrong password and unknown email look identical; logout clears the session', async () => {
  await registeredUser('login@test.com');
  const c = client();
  const wrong = await c('POST', '/api/auth/login', { email: 'login@test.com', password: 'WrongPass1' });
  const unknown = await c('POST', '/api/auth/login', { email: 'ghost@test.com', password: 'WrongPass1' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.json, unknown.json);

  const loggedOut = await c('GET', '/api/auth/me');
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.json.user, null);
  await c('POST', '/api/auth/login', { email: 'login@test.com', password: 'Passw0rd1' });
  assert.equal((await c('GET', '/api/auth/me')).json.user.email, 'login@test.com');
  await c('POST', '/api/auth/logout');
  assert.equal((await c('GET', '/api/auth/me')).json.user, null);
});

test('session cookie is HttpOnly and SameSite=Strict', async () => {
  const c = client();
  await c('POST', '/api/auth/register', { name: 'Cookie Test', email: 'cookie@test.com', password: 'Passw0rd1' });
  const res = await c('POST', '/api/auth/login', { email: 'cookie@test.com', password: 'Passw0rd1' });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('login is rate limited after repeated failures', async () => {
  // Its own server instance: the limiter is per address, and every test here shares 127.0.0.1.
  const limited = await start({
    port: 0, dataDir: tmp, dbPath: ':memory:', logRequests: false,
    adminEmail: 'limit-admin@test.com', adminPassword: 'Admin1234',
    rateLimits: { loginMax: 5, registerMax: 1000 },
  });
  try {
    const url = `http://127.0.0.1:${limited.server.address().port}`;
    const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    assert.equal((await post('/api/auth/register', { name: 'Limit User', email: 'limited@test.com', password: 'Passw0rd1' })).status, 201);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await post('/api/auth/login', { email: 'limited@test.com', password: 'WrongPass1' })).status, 401);
    }
    // Even the correct password is refused while the limit is active.
    const blocked = await post('/api/auth/login', { email: 'limited@test.com', password: 'Passw0rd1' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally {
    await limited.close();
  }
});

test('add review requires login', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/reviews', goodReview)).status, 401);
  assert.equal((await c('GET', '/api/reviews/mine')).status, 401);
});

test('add review stores every field and sets the author from the session', async () => {
  const c = await registeredUser('author@test.com');
  const res = await c('POST', '/api/reviews', { ...goodReview, user_id: 1 });
  assert.equal(res.status, 201);
  const r = res.json.review;
  assert.equal(r.company_name, 'Acme Corp');
  assert.equal(r.product_purchased, 'Acme Blender 3000');
  assert.equal(r.purchase_date, '2026-10-01');
  assert.equal(r.reviewer_name, 'Asha Rao');
  assert.equal(r.price, 4999.5);
  assert.equal(r.rating, 4);
  assert.equal(r.review_text, goodReview.review_text);

  const mine = await c('GET', '/api/reviews/mine');
  assert.equal(mine.json.reviews.length, 1);
  assert.equal(mine.json.pagination.total, 1);
});

test('review validation reports each bad field', async () => {
  const c = await registeredUser('invalid@test.com');
  const empty = await c('POST', '/api/reviews', {});
  assert.equal(empty.status, 400);
  for (const f of ['company_name', 'product_purchased', 'purchase_date', 'reviewer_name', 'price', 'rating', 'review_text']) {
    assert.ok(empty.json.error.fields[f], `expected an error for ${f}`);
  }

  const cases = [
    [{ price: '-5' }, 'price'],
    [{ price: '12.345' }, 'price'],
    [{ price: 'abc' }, 'price'],
    [{ rating: 6 }, 'rating'],
    [{ rating: 0 }, 'rating'],
    [{ purchase_date: '2999-01-01' }, 'purchase_date'],
    [{ purchase_date: '2026-02-30' }, 'purchase_date'],
    [{ purchase_date: '01/10/2026' }, 'purchase_date'],
    [{ review_text: 'too short' }, 'review_text'],
    [{ review_text: 'x'.repeat(2001) }, 'review_text'],
    [{ currency: 'XXX' }, 'currency'],
  ];
  for (const [patch, field] of cases) {
    const res = await c('POST', '/api/reviews', { ...goodReview, ...patch });
    assert.equal(res.status, 400, `${JSON.stringify(patch)} should be rejected`);
    assert.ok(res.json.error.fields[field], `${field} should be flagged for ${JSON.stringify(patch)}`);
  }
});

test('malformed requests get clean errors', async () => {
  const c = await registeredUser('malformed@test.com');
  const badJson = await fetch(`${base}/api/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(badJson.status, 401); // auth is checked before the body is read

  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(login.status, 400);

  const wrongType = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(wrongType.status, 415);

  const huge = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(60 * 1024) }) });
  assert.equal(huge.status, 413);

  assert.equal((await c('GET', '/api/nope')).status, 404);
});

test('cross-origin state-changing requests are refused', async () => {
  const c = client();
  const res = await c('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('a user only sees their own reviews', async () => {
  const a = await registeredUser('usera@test.com');
  const b = await registeredUser('userb@test.com');
  await a('POST', '/api/reviews', { ...goodReview, company_name: 'Alpha Ltd' });
  await b('POST', '/api/reviews', { ...goodReview, company_name: 'Beta Ltd' });
  const mineA = (await a('GET', '/api/reviews/mine')).json.reviews.map((r) => r.company_name);
  assert.deepEqual(mineA, ['Alpha Ltd']);
});

test('users cannot reach admin endpoints; anonymous gets 401', async () => {
  const user = await registeredUser('plain@test.com');
  const anon = client();
  for (const url of ['/api/admin/reviews', '/api/admin/summary', '/api/admin/reviews/1']) {
    assert.equal((await user('GET', url)).status, 403, url);
    assert.equal((await anon('GET', url)).status, 401, url);
  }
});

test('admin sees every user\'s reviews with company, product and who submitted them', async () => {
  const u1 = await registeredUser('seen1@test.com');
  const u2 = await registeredUser('seen2@test.com');
  await u1('POST', '/api/reviews', { ...goodReview, company_name: 'Zenith Foods', product_purchased: 'Tea Box' });
  await u2('POST', '/api/reviews', { ...goodReview, company_name: 'Zenith Foods', product_purchased: 'Coffee Beans', rating: 2 });

  const admin = await adminClient();
  const all = await admin('GET', '/api/admin/reviews?company=zenith&pageSize=50');
  assert.equal(all.status, 200);
  assert.equal(all.json.reviews.length, 2);
  const emails = all.json.reviews.map((r) => r.user.email).sort();
  assert.deepEqual(emails, ['seen1@test.com', 'seen2@test.com']);
  assert.ok(all.json.reviews.every((r) => r.company_name && r.product_purchased && r.review_text));

  const filtered = await admin('GET', '/api/admin/reviews?company=zenith&product=coffee');
  assert.equal(filtered.json.reviews.length, 1);
  assert.equal(filtered.json.reviews[0].product_purchased, 'Coffee Beans');

  const byRating = await admin('GET', '/api/admin/reviews?company=zenith&rating=2');
  assert.equal(byRating.json.reviews.length, 1);

  const one = await admin('GET', `/api/admin/reviews/${all.json.reviews[0].id}`);
  assert.equal(one.status, 200);
  assert.equal((await admin('GET', '/api/admin/reviews/999999')).status, 404);

  const summary = await admin('GET', '/api/admin/summary');
  assert.equal(summary.status, 200);
  assert.ok(summary.json.totals.reviews >= 2);
  assert.ok(summary.json.companies.some((c) => c.company_name === 'Zenith Foods' && c.reviews === 2));
});

test('admin search treats % and _ literally and sorts/paginates', async () => {
  const u = await registeredUser('search@test.com');
  for (let i = 0; i < 3; i += 1) await u('POST', '/api/reviews', { ...goodReview, company_name: `Pager Co ${i}`, rating: i + 1 });
  const admin = await adminClient();

  const literal = await admin('GET', '/api/admin/reviews?q=%25');
  assert.equal(literal.status, 200);
  assert.equal(literal.json.pagination.total, 0);

  const page1 = await admin('GET', '/api/admin/reviews?company=Pager%20Co&pageSize=2&sort=rating_high');
  assert.equal(page1.json.reviews.length, 2);
  assert.equal(page1.json.reviews[0].rating, 3);
  assert.equal(page1.json.pagination.totalPages, 2);
  const page2 = await admin('GET', '/api/admin/reviews?company=Pager%20Co&pageSize=2&page=2&sort=rating_high');
  assert.equal(page2.json.reviews.length, 1);

  assert.equal((await admin('GET', '/api/admin/reviews?sort=bogus')).status, 400);
  assert.equal((await admin('GET', '/api/admin/reviews?page=0')).status, 400);
});

test('admins cannot delete or change reviews (API and database)', async () => {
  const u = await registeredUser('keeper@test.com');
  const created = await u('POST', '/api/reviews', goodReview);
  const id = created.json.review.id;
  const admin = await adminClient();

  for (const method of ['DELETE', 'PUT', 'PATCH', 'POST']) {
    const res = await admin(method, `/api/admin/reviews/${id}`, method === 'DELETE' ? undefined : {});
    assert.equal(res.status, 405, `${method} must not be allowed`);
    assert.equal(res.headers.get('allow'), 'GET');
  }
  assert.equal((await u('DELETE', `/api/reviews/${id}`)).status, 404);
  assert.equal((await admin('GET', `/api/admin/reviews/${id}`)).status, 200);

  assert.throws(() => app.db.exec('DELETE FROM reviews'), /cannot be deleted/);
  assert.throws(() => app.db.prepare('DELETE FROM reviews WHERE id = ?').run(id), /cannot be deleted/);
  assert.equal((await admin('GET', `/api/admin/reviews/${id}`)).status, 200);
});

test('admin account cannot add reviews (user-only action)', async () => {
  const admin = await adminClient();
  assert.equal((await admin('POST', '/api/reviews', goodReview)).status, 403);
});

test('review text is stored and returned as plain text (no markup injection)', async () => {
  const u = await registeredUser('xss@test.com');
  const payload = '<script>alert(1)</script> this product was surprisingly decent overall';
  const res = await u('POST', '/api/reviews', { ...goodReview, review_text: payload });
  assert.equal(res.status, 201);
  assert.equal(res.json.review.review_text, payload);
});

test('static pages are served with security headers and path traversal is blocked', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');

  for (const p of ['admin.html', 'register.html', 'add-review.html', 'my-reviews.html', 'css/app.css', 'js/common.js']) {
    assert.equal((await fetch(`${base}/${p}`)).status, 200, p);
  }
  const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.equal(traversal.status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/src/config.js`)).status, 404);
});
