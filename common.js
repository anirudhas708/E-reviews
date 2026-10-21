/* Shared helpers. Everything is built with DOM APIs and textContent, never innerHTML, so user text cannot inject markup. */
(() => {
  'use strict';

  const h = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value == null) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  class ApiError extends Error {
    constructor(status, code, message, fields) {
      super(message);
      this.status = status;
      this.code = code;
      this.fields = fields;
    }
  }

  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON body
    }
    if (!res.ok) {
      const e = (data && data.error) || {};
      throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Something went wrong. Try again.', e.fields);
    }
    return data;
  }

  const api = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
  };

  const homeFor = (user) => (user.role === 'admin' ? 'admin.html' : 'add-review.html');

  /** The logged-in user, or null when logged out. */
  async function me() {
    return (await api.get('/api/auth/me')).user;
  }

  /** Page guard: resolves with the user, or redirects and never resolves. */
  async function requireUser(role) {
    let user;
    try {
      user = await me();
    } catch {
      user = null;
    }
    if (!user) {
      location.replace('index.html');
      return new Promise(() => {});
    }
    if (role && user.role !== role) {
      location.replace(homeFor(user));
      return new Promise(() => {});
    }
    return user;
  }

  function mountHeader(user, current) {
    const top = document.getElementById('top');
    if (!top) return;
    const links = user
      ? user.role === 'admin'
        ? [['admin.html', 'All reviews']]
        : [['add-review.html', 'Add review'], ['my-reviews.html', 'My reviews']]
      : [];
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, links.map(([href, label]) =>
      h('a', { href, 'aria-current': href === current ? 'page' : false }, label)));

    const children = [h('a', { class: 'brand', href: user ? homeFor(user) : 'index.html' }, 'E-Reviews'), nav];
    if (user) {
      const logout = h('button', { class: 'btn btn--small', type: 'button' }, 'Log out');
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        try {
          await api.post('/api/auth/logout');
        } finally {
          location.replace('index.html');
        }
      });
      children.push(h('div', { class: 'who' },
        h('span', null, h('strong', null, user.name), user.role === 'admin' ? ' (admin)' : ''), logout));
    }
    top.replaceChildren(h('div', { class: 'wrap top__inner' }, children));
  }

  function stars(rating) {
    const wrap = h('span', { class: 'stars', role: 'img', 'aria-label': `${rating} out of 5 stars` });
    for (let i = 1; i <= 5; i += 1) wrap.append(h('span', { class: i <= rating ? 'on' : '', 'aria-hidden': 'true' }, '★'));
    return wrap;
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  function dateOnly(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function dateTime(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function clearErrors(form) {
    form.querySelectorAll('[data-error-for]').forEach((el) => { el.hidden = true; el.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const notice = form.querySelector('.notice');
    if (notice) notice.hidden = true;
  }

  /** Shows per-field messages; returns true if any field was marked. Moves focus to the first one. */
  function showFieldErrors(form, fields) {
    let first = null;
    for (const [name, message] of Object.entries(fields || {})) {
      const slot = form.querySelector(`[data-error-for="${name}"]`);
      if (!slot) continue;
      slot.textContent = message;
      slot.hidden = false;
      const inputs = form.querySelectorAll(`[name="${name}"]`);
      inputs.forEach((input) => {
        if (input.type !== 'radio') input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', slot.id);
      });
      if (!first && inputs[0]) first = inputs[0];
    }
    if (first) first.focus();
    return Boolean(first);
  }

  /** Clears a field's error as soon as the user edits that field. */
  function watchForm(form) {
    const clearOne = (event) => {
      const name = event.target && event.target.name;
      if (!name) return;
      const slot = form.querySelector(`[data-error-for="${name}"]`);
      if (!slot || slot.hidden) return;
      slot.hidden = true;
      slot.textContent = '';
      form.querySelectorAll(`[name="${name}"]`).forEach((input) => {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      });
    };
    form.addEventListener('input', clearOne);
    form.addEventListener('change', clearOne);
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function showNotice(form, message, kind = 'error') {
    const notice = form.querySelector('.notice');
    if (!notice) return;
    notice.textContent = message;
    notice.className = `notice notice--${kind}`;
    notice.hidden = false;
  }

  function setBusy(button, busy, idleLabel, busyLabel) {
    button.disabled = busy;
    button.textContent = busy ? busyLabel : idleLabel;
  }

  /** Handles an API failure for a form: field errors where possible, otherwise a notice. */
  function handleFormError(form, err) {
    if (err.fields && showFieldErrors(form, err.fields)) {
      showNotice(form, err.message);
    } else {
      showNotice(form, err.message);
    }
  }

  window.ER = { h, api, ApiError, me, requireUser, homeFor, mountHeader, stars, money, dateOnly, dateTime, clearErrors, showFieldErrors, showNotice, setBusy, handleFormError, watchForm, plural };
})();
