'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { Router } = require('./router');
const { RateLimiter } = require('./rate-limiter');
const { HttpError } = require('./errors');
const { sendJson, sendText } = require('./http-utils');
const { ensureAdmin } = require('./admin-seed');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function buildRouter() {
  const router = new Router();
  require('./routes/auth').register(router);
  require('./routes/reviews').register(router);
  require('./routes/admin').register(router);
  return router;
}

/**
 * CSRF defence in depth for state-changing requests: the session cookie is
 * SameSite=Strict, bodies must be application/json, and if the browser sends
 * an Origin header it must match the Host we were addressed as.
 */
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'BAD_ORIGIN', 'Cross-origin requests are not allowed.');
  }
  if (originHost !== req.headers.host) throw new HttpError(403, 'BAD_ORIGIN', 'Cross-origin requests are not allowed.');
}

function serveStatic(config, req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (rel.includes('\0')) return sendText(res, 400, 'Bad request');
  if (rel === '/' || rel === '') rel = '/index.html';

  const root = path.resolve(config.publicDir);
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return sendText(res, 404, 'Not found');

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return sendText(res, 404, 'Not found');
  }
  if (!stat.isFile()) return sendText(res, 404, 'Not found');

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
  return undefined;
}

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.dbPath);
  const router = buildRouter();
  const limiters = {
    login: new RateLimiter({ max: config.rateLimits.loginMax, windowMs: config.rateLimits.loginWindowMs }),
    register: new RateLimiter({ max: config.rateLimits.registerMax, windowMs: config.rateLimits.registerWindowMs }),
  };

  const adminResult = ensureAdmin(db, config.admin);

  async function handle(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const started = Date.now();
    if (config.logRequests) {
      res.on('finish', () => console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`));
    }

    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;

      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        }
        return serveStatic(config, req, res, pathname);
      }

      res.setHeader('Cache-Control', 'no-store');
      const { route, params, allowed } = router.resolve(req.method, pathname);
      if (!route) {
        if (allowed.length > 0) {
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This action is not allowed.', undefined, {
            Allow: allowed.join(', '),
          });
        }
        throw new HttpError(404, 'NOT_FOUND', 'No such API endpoint.');
      }

      if (req.method !== 'GET') assertSameOrigin(req);

      const ctx = { req, res, config, db, limiters, params, query: Object.fromEntries(url.searchParams), user: null };
      for (const guard of route.guards) await guard(ctx);
      await route.handler(ctx);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return undefined;
      }
      if (err instanceof HttpError) {
        const payload = { error: { code: err.code, message: err.message } };
        if (err.fields) payload.error.fields = err.fields;
        return sendJson(res, err.status, payload, err.headers);
      }
      console.error('Unhandled error:', err);
      return sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' } });
    }
    return undefined;
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  function close() {
    return new Promise((resolve) => {
      limiters.login.close();
      limiters.register.close();
      const done = () => {
        try {
          db.close();
        } catch {
          // already closed
        }
        resolve();
      };
      if (server.listening) {
        server.close(done);
        server.closeAllConnections?.();
      } else {
        done();
      }
    });
  }

  return { server, db, config, adminResult, close };
}

function start(overrides = {}) {
  const app = createApp(overrides);
  return new Promise((resolve) => {
    app.server.listen(app.config.port, app.config.host, () => resolve(app));
  });
}

module.exports = { createApp, start };

if (require.main === module) {
  start().then((app) => {
    const { port } = app.server.address();
    console.log(`\nE-Reviews is running at http://${app.config.host === '0.0.0.0' ? 'localhost' : app.config.host}:${port}`);
    if (app.adminResult.status === 'created') console.log(`Admin account created: ${app.adminResult.email}`);
    if (app.config.admin.usingDemoCredentials) {
      console.log('DEMO admin login -> admin@example.com / Admin@12345  (set ADMIN_EMAIL and ADMIN_PASSWORD to change it)');
    }
    if (!app.config.admin.email) console.log('No admin configured. Set ADMIN_EMAIL and ADMIN_PASSWORD, then restart.');

    const shutdown = () => app.close().then(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
