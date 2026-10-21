(async () => {
  'use strict';
  const { h, api, requireUser, mountHeader, stars, money, dateOnly, dateTime } = ER;

  const user = await requireUser('user');
  mountHeader(user, 'my-reviews.html');

  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const loading = document.getElementById('loading');
  const errorBox = document.getElementById('error');
  const pager = document.getElementById('pager');
  const info = document.getElementById('pager-info');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  let page = 1;

  function row(r) {
    return h('li', null,
      h('div', { class: 'ledger__top' },
        h('h2', { class: 'ledger__title' }, r.product_purchased, ' ', h('span', null, `from ${r.company_name}`)),
        h('span', { class: 'ledger__price' }, money(r.price, r.currency))),
      h('div', { class: 'ledger__meta' },
        stars(r.rating),
        h('span', null, `Purchased ${dateOnly(r.purchase_date)}`),
        h('span', null, `Submitted ${dateTime(r.created_at)}`)),
      h('p', { class: 'ledger__text' }, r.review_text));
  }

  async function load() {
    loading.hidden = false;
    errorBox.hidden = true;
    try {
      const data = await api.get(`/api/reviews/mine?page=${page}`);
      const { total, totalPages } = data.pagination;
      list.replaceChildren(...data.reviews.map(row));
      list.hidden = total === 0;
      empty.hidden = total !== 0;
      pager.hidden = totalPages <= 1;
      info.textContent = `Page ${page} of ${totalPages}, ${ER.plural(total, 'review')}`;
      prev.disabled = page <= 1;
      next.disabled = page >= totalPages;
    } catch (err) {
      if (err.status === 401) return location.replace('index.html');
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      loading.hidden = true;
    }
    return undefined;
  }

  prev.addEventListener('click', () => { page -= 1; load(); window.scrollTo({ top: 0 }); });
  next.addEventListener('click', () => { page += 1; load(); window.scrollTo({ top: 0 }); });
  load();
})();
