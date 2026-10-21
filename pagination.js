'use strict';

const { validationError } = require('./errors');

/** Reads ?page= and ?pageSize= (1-based). Bad values are rejected; oversize pages are clamped. */
function parsePagination(query, { defaultSize = 10, maxSize = 50 } = {}) {
  const errors = {};

  let page = 1;
  if (query.page !== undefined) {
    if (!/^\d+$/.test(query.page) || Number(query.page) < 1) errors.page = 'page must be a positive whole number.';
    else page = Number(query.page);
  }

  let pageSize = defaultSize;
  if (query.pageSize !== undefined) {
    if (!/^\d+$/.test(query.pageSize) || Number(query.pageSize) < 1) errors.pageSize = 'pageSize must be a positive whole number.';
    else pageSize = Math.min(Number(query.pageSize), maxSize);
  }

  if (Object.keys(errors).length > 0) throw validationError(errors);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = { parsePagination };
