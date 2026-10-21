# E-Reviews

Customer feedback application. Consumers register, log in and submit reviews about things they bought. Admins log in and read every submitted review by company and product. **Admins cannot delete reviews.**

Runs with **no npm dependencies**: Node's built-in HTTP server, `node:sqlite` and `node:crypto`. Nothing to install.

## Quick start

Requires **Node.js 22.13 or newer**.

```bash
npm start
```

Open http://127.0.0.1:3000.

In development (when `NODE_ENV` is not `production`) a demo admin is created automatically:

| Role  | Email               | Password       |
|-------|---------------------|----------------|
| Admin | `admin@example.com` | `Admin@12345`  |

Users register themselves on the **Create account** page. For anything beyond local use, set your own admin (see [Configuration](#configuration)).

## What it does

**Consumer**
1. **Register** with name, email and password (the password needs 8+ characters with a letter and a number). Registering does not log you in.
2. **Log in**, then land on **Add review**.
3. **Add review** form fields: company name, product purchased, date of purchase, your name, price (with currency), a 1 to 5 star rating, and a detailed review.
4. **My reviews** lists only your own reviews, newest first.

**Admin**
1. Log in with the admin account and land on **Submitted reviews**.
2. See every user's reviews: company, product, reviewer, purchase date, price, rating, submitted time, and which account submitted it. Select a row to read the full review.
3. Search, filter by company, product or rating, sort, and page through results. A per-company summary shows review counts and average ratings.
4. **No delete, no edit.** This is enforced three ways: no such endpoint exists, any non-GET request on admin review URLs returns `405 Method Not Allowed`, and a database trigger aborts any `DELETE` on the `reviews` table.

## Project layout

```
public/               Frontend (plain HTML, CSS, JS; no build step)
  index.html            Log in
  register.html         Create account
  add-review.html       Add review (consumer)
  my-reviews.html       My reviews (consumer)
  admin.html            Submitted reviews (admin)
  css/app.css, js/*.js
src/
  server.js             HTTP server, static files, security headers
  config.js             Environment configuration
  db.js                 SQLite schema + no-delete trigger
  auth.js               scrypt password hashing, signed session tokens
  guards.js             requireAuth / requireRole
  validators.js         Input validation for every form
  routes/               auth.js, reviews.js, admin.js
scripts/seed-admin.js   Create or promote an admin account
test/api.test.js        18 automated API tests
```

## API

All bodies are JSON (`Content-Type: application/json`). Errors look like `{ "error": { "code", "message", "fields?" } }`.

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/api/auth/register` | anyone | Create a consumer account |
| POST | `/api/auth/login` | anyone | Log in (sets an HttpOnly session cookie) |
| POST | `/api/auth/logout` | anyone | Log out |
| GET | `/api/auth/me` | anyone | Current user, or `{ "user": null }` |
| POST | `/api/reviews` | user | Add a review (author is the logged-in user) |
| GET | `/api/reviews/mine?page=` | user | Your own reviews |
| GET | `/api/admin/reviews` | admin | All reviews. Query: `q`, `company`, `product`, `rating`, `sort`, `page`, `pageSize` |
| GET | `/api/admin/reviews/:id` | admin | One review |
| GET | `/api/admin/summary` | admin | Totals and per-company averages |

`sort` is one of `newest`, `oldest`, `rating_high`, `rating_low`, `company`.

## Configuration

Set environment variables (see `.env.example`). The ones that matter:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Use `HOST=0.0.0.0` in a container |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | demo admin (dev only) | **Required when `NODE_ENV=production`** |
| `JWT_SECRET` | generated into `data/.jwt-secret` | Signs session cookies |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy so rate limits use the real client IP |
| `DATA_DIR` | `./data` | Holds the SQLite database |

Create or rotate an admin without starting the server:

```bash
ADMIN_EMAIL=boss@company.com ADMIN_PASSWORD='S3cret-pass1' npm run seed:admin
ADMIN_RESET_PASSWORD=true ADMIN_EMAIL=boss@company.com ADMIN_PASSWORD='New-pass2' npm run seed:admin
```

## Security notes

- Passwords are hashed with scrypt and a per-user salt. Login takes the same time for unknown emails and wrong passwords, and returns the same message.
- Sessions are signed, expiring, `HttpOnly`, `SameSite=Strict` cookies. A user's role is read from the database on every request, never trusted from the cookie.
- Admin accounts cannot be created through the public API, even if a `role` field is sent.
- Login and registration are rate limited (10 failed logins per 15 minutes per address and per account).
- Cross-site requests are refused: JSON-only bodies, an `Origin` check, and SameSite cookies.
- A strict Content-Security-Policy is sent, and the frontend writes user text with `textContent` only, so review text cannot inject markup.
- All SQL uses bound parameters. Prices are stored as integer cents.

## Tests

```bash
npm test
```

Covers registration, login, sessions, rate limiting, review validation, per-user visibility, admin access control, filtering and paging, the no-delete rule (API and database), and static file safety.

## Limits to know about

- `node:sqlite` is still marked experimental in Node (a warning is silenced in the npm scripts). It is fine for a single server; move to PostgreSQL or MySQL for multiple servers.
- The rate limiter keeps counts in memory, so it resets on restart and is per process.
- There is no email verification or password reset yet. Those are the natural next features.
