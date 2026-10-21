'use strict';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const CONTROL_CHARS_KEEP_NEWLINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const MIN_PURCHASE_DATE = '1990-01-01';
const isString = (v) => typeof v === 'string';
const hasErrors = (errors) => Object.keys(errors).length > 0;

const cleanLine = (value) => value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
const cleanText = (value) => value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS_KEEP_NEWLINES, '').trim();

function textField(errors, key, raw, label, { min, max, multiline = false }) {
  if (!isString(raw)) {
    errors[key] = `${label} is required.`;
    return '';
  }
  const value = multiline ? cleanText(raw) : cleanLine(raw);
  if (value.length === 0) errors[key] = `${label} is required.`;
  else if (value.length < min) errors[key] = `${label} must be at least ${min} characters.`;
  else if (value.length > max) errors[key] = `${label} must be at most ${max} characters.`;
  return value;
}

function personName(errors, key, raw, label) {
  const value = textField(errors, key, raw, label, { min: 2, max: 80 });
  if (!errors[key] && !/\p{L}/u.test(value)) errors[key] = `${label} must contain letters.`;
  return value;
}

function validatePassword(raw) {
  if (!isString(raw) || raw.length === 0) return 'Password is required.';
  if (raw.length < 8) return 'Password must be at least 8 characters.';
  if (raw.length > 128) return 'Password must be at most 128 characters.';
  if (!/[A-Za-z]/.test(raw) || !/\d/.test(raw)) return 'Password must contain at least one letter and one number.';
  return null;
}

function validateEmail(raw) {
  if (!isString(raw) || raw.trim().length === 0) return { error: 'Email is required.', value: '' };
  const value = raw.trim().toLowerCase();
  if (value.length > 254 || !EMAIL_RE.test(value)) return { error: 'Enter a valid email address.', value };
  return { error: null, value };
}

function validateRegistration(body) {
  const errors = {};
  const name = personName(errors, 'name', body.name, 'Name');

  const email = validateEmail(body.email);
  if (email.error) errors.email = email.error;

  const passwordError = validatePassword(body.password);
  if (passwordError) errors.password = passwordError;
  else if (body.confirmPassword !== undefined && body.confirmPassword !== body.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  return { errors, value: { name, email: email.value, password: body.password } };
}

function validateLogin(body) {
  const errors = {};
  const email = validateEmail(body.email);
  if (email.error) errors.email = email.error;
  if (!isString(body.password) || body.password.length === 0) errors.password = 'Password is required.';
  else if (body.password.length > 1024) errors.password = 'Password is too long.';
  return { errors, value: { email: email.value, password: body.password } };
}

function parseIsoDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date : null;
}

/** "1299.50" -> 129950. Exact (no floating point): max 8 whole digits, 2 decimals. */
function parsePriceToCents(raw) {
  if (typeof raw !== 'number' && !isString(raw)) return null;
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(raw).trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

function parseRating(raw) {
  const n = isString(raw) && /^\d$/.test(raw.trim()) ? Number(raw) : raw;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function validateReview(body, now = new Date()) {
  const errors = {};

  const company_name = textField(errors, 'company_name', body.company_name, 'Company name', { min: 2, max: 100 });
  const product_purchased = textField(errors, 'product_purchased', body.product_purchased, 'Product purchased', { min: 2, max: 100 });
  const reviewer_name = personName(errors, 'reviewer_name', body.reviewer_name, 'Your name');

  let purchase_date = '';
  if (!isString(body.purchase_date) || body.purchase_date.trim() === '') {
    errors.purchase_date = 'Date of purchase is required.';
  } else {
    purchase_date = body.purchase_date.trim();
    const parsed = parseIsoDate(purchase_date);
    // One day of slack so a purchaser far ahead of the server's UTC clock isn't rejected.
    const latest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    if (!parsed) errors.purchase_date = 'Enter a valid date (YYYY-MM-DD).';
    else if (parsed > latest) errors.purchase_date = 'Date of purchase cannot be in the future.';
    else if (purchase_date < MIN_PURCHASE_DATE) errors.purchase_date = 'Date of purchase is too far in the past.';
  }

  let price_cents = null;
  if (body.price === undefined || body.price === null || body.price === '') {
    errors.price = 'Pricing is required.';
  } else {
    price_cents = parsePriceToCents(body.price);
    if (price_cents === null) errors.price = 'Enter a valid price, for example 1299 or 1299.50.';
  }

  const currency = body.currency === undefined ? 'INR' : body.currency;
  if (!CURRENCIES.includes(currency)) errors.currency = `Currency must be one of ${CURRENCIES.join(', ')}.`;

  const rating = parseRating(body.rating);
  if (rating === null) errors.rating = 'Choose a rating from 1 to 5.';

  const review_text = textField(errors, 'review_text', body.review_text, 'Review', { min: 20, max: 2000, multiline: true });

  return {
    errors,
    value: { company_name, product_purchased, purchase_date, reviewer_name, price_cents, currency, rating, review_text },
  };
}

module.exports = {
  CURRENCIES,
  hasErrors,
  validatePassword,
  validateEmail,
  validateRegistration,
  validateLogin,
  validateReview,
};
