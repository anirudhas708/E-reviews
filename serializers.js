'use strict';

/** Columns every review query selects, so the serializers below can rely on them. */
const REVIEW_COLUMNS = `
  r.id, r.user_id, r.company_name, r.product_purchased, r.purchase_date, r.reviewer_name,
  r.price_cents, r.currency, r.rating, r.review_text, r.created_at`;

function serializeReview(row) {
  return {
    id: row.id,
    company_name: row.company_name,
    product_purchased: row.product_purchased,
    purchase_date: row.purchase_date,
    reviewer_name: row.reviewer_name,
    price: row.price_cents / 100,
    currency: row.currency,
    rating: row.rating,
    review_text: row.review_text,
    created_at: row.created_at,
  };
}

function serializeReviewForAdmin(row) {
  return {
    ...serializeReview(row),
    user: { id: row.user_id, name: row.user_name, email: row.user_email },
  };
}

module.exports = { REVIEW_COLUMNS, serializeReview, serializeReviewForAdmin };
