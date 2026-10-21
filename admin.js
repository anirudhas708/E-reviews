(async () => {
  'use strict';
  const { h, api, requireUser, mountHeader, stars, money, dateOnly, dateTime } = ER;

  const user = await requireUser('admin');
  mountHeader(user, 'admin.html');

  const filtersForm = document.getElementById('filters');
  const rowsEl = document.getElementById('rows');
  const emptyEl = document.getElementById('empty');
  const tableWrap = document.getElementById('table-wrap');
  const errorBox = document.getElementById('error');
  const pager = document.getElementById('pager');
  const info = document.getElementById('pager-info');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const companiesEl = document.getElementById('companies');
  const el = (name) => filtersForm.elements.namedItem(name);

  let page = 1;
  let requestId = 0;

  function currentFilters() {
    const params = new URLSearchParams();
    for (const name of ['q', 'company', 'product', 'rating', 'sort']) {
      const value = el(name).value.trim();
      if (value) params.set(name, value);
    }
    return params;
  }

  const hasActiveFilters = () => ['q', 'company', 'product', 'rating'].some((n) => el(n).value.trim() !== '');

  function reviewRows(r) {
    const detailId = `detail-${r.id}`;
    const toggle = h('button', { class: 'link-button expander', type: 'button', 'aria-expanded': 'false', 'aria-controls': detailId },
      h('span', null, r.company_name, h('span', { class: 'sub' }, r.product_purchased)));
    const detail = h('tr', { class: 'detail', id: detailId, hidden: true },
      h('td', { colspan: '6' },
        h('p', null, r.review_text),
        h('span', { class: 'sub' }, `Review #${r.id}, submitted by ${r.user.name} (${r.user.email})`)));

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      detail.hidden = open;
    });

    const main = h('tr', { class: 'main' },
      h('td', { class: 'cell-main', 'data-label': 'Company and product' }, toggle),
      h('td', { 'data-label': 'Reviewer' }, h('span', null, r.reviewer_name, h('span', { class: 'sub' }, r.user.email))),
      h('td', { 'data-label': 'Purchased' }, dateOnly(r.purchase_date)),
      h('td', { class: 'num', 'data-label': 'Price' }, money(r.price, r.currency)),
      h('td', { 'data-label': 'Rating' }, stars(r.rating)),
      h('td', { 'data-label': 'Submitted' }, dateTime(r.created_at)));
    return [main, detail];
  }

  function showEmpty(filtered) {
    const children = filtered
      ? [h('h2', null, 'No reviews match these filters'), h('p', null, 'Try a different search, or clear the filters to see every review.')]
      : [h('h2', null, 'No reviews yet'), h('p', null, 'Reviews appear here as soon as users submit them.')];
    if (filtered) {
      const button = h('button', { class: 'btn btn--small', type: 'button' }, 'Clear filters');
      button.addEventListener('click', clearFilters);
      children.push(button);
    }
    emptyEl.replaceChildren(...children);
    emptyEl.hidden = false;
  }

  async function load() {
    const mine = ++requestId;
    errorBox.hidden = true;
    const params = currentFilters();
    params.set('page', String(page));
    params.set('pageSize', '10');
    try {
      const data = await api.get(`/api/admin/reviews?${params}`);
      if (mine !== requestId) return undefined; // a newer request superseded this one
      const { total, totalPages } = data.pagination;
      rowsEl.replaceChildren(...data.reviews.flatMap(reviewRows));
      tableWrap.querySelector('table').hidden = data.reviews.length === 0;
      emptyEl.hidden = true;
      if (data.reviews.length === 0) showEmpty(hasActiveFilters());
      pager.hidden = totalPages <= 1;
      info.textContent = `Page ${page} of ${totalPages}, ${ER.plural(total, 'review')}`;
      prev.disabled = page <= 1;
      next.disabled = page >= totalPages;
      document.querySelectorAll('#companies button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.company.toLowerCase() === el('company').value.trim().toLowerCase()));
      });
    } catch (err) {
      if (err.status === 401 || err.status === 403) return location.replace('index.html');
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
    return undefined;
  }

  function clearFilters() {
    filtersForm.reset();
    page = 1;
    load();
  }

  async function loadSummary() {
    try {
      const { totals, companies } = await api.get('/api/admin/summary');
      const figure = (value, label) => h('div', null, h('strong', null, String(value)), h('span', null, label));
      document.getElementById('figures').replaceChildren(
        figure(totals.reviews, 'reviews'),
        figure(totals.companies, 'companies'),
        figure(totals.registered_users, 'registered users'),
        figure(totals.reviews ? totals.average_rating.toFixed(1) : '-', 'average rating'));
      companiesEl.replaceChildren(...companies.map((c) => {
        const button = h('button', { type: 'button', 'aria-pressed': 'false', 'data-company': c.company_name },
          c.company_name, h('small', null, `${ER.plural(c.reviews, 'review')}, ${c.average_rating.toFixed(1)} avg`));
        button.addEventListener('click', () => {
          const active = el('company').value.trim().toLowerCase() === c.company_name.toLowerCase();
          el('company').value = active ? '' : c.company_name;
          page = 1;
          load();
        });
        return button;
      }));
    } catch {
      // The summary is a convenience; the table still works without it.
    }
  }

  let timer;
  filtersForm.addEventListener('input', (event) => {
    clearTimeout(timer);
    const delay = event.target.tagName === 'SELECT' ? 0 : 300;
    timer = setTimeout(() => { page = 1; load(); }, delay);
  });
  filtersForm.addEventListener('submit', (event) => event.preventDefault());
  document.getElementById('clear').addEventListener('click', clearFilters);
  prev.addEventListener('click', () => { page -= 1; load(); });
  next.addEventListener('click', () => { page += 1; load(); });

  loadSummary();
  load();
})();
