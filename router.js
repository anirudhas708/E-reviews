'use strict';

const { HttpError } = require('./errors');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Minimal method + path router with `:param` support and route guards. */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, guards, handler) {
    const keys = [];
    const pattern = escapeRegex(path).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, regex: new RegExp(`^${pattern}/?$`), keys, guards, handler });
  }

  get(path, guards, handler) {
    this.add('GET', path, guards, handler);
  }

  post(path, guards, handler) {
    this.add('POST', path, guards, handler);
  }

  /**
   * Finds the route for a request. When the path exists but not for this
   * method, `allowed` lists the methods that are supported (-> HTTP 405).
   */
  resolve(method, pathname) {
    const allowed = new Set();
    for (const route of this.routes) {
      const match = route.regex.exec(pathname);
      if (!match) continue;
      if (route.method !== method) {
        allowed.add(route.method);
        continue;
      }
      const params = {};
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(match[i + 1]);
        } catch {
          throw new HttpError(400, 'BAD_REQUEST', 'Malformed URL.');
        }
      });
      return { route, params, allowed: [] };
    }
    return { route: null, params: {}, allowed: [...allowed] };
  }
}

module.exports = { Router };
