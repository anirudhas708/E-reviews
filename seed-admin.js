'use strict';

/**
 * Creates (or promotes) the admin account.
 *
 *   ADMIN_EMAIL=boss@company.com ADMIN_PASSWORD='S3cret-pass1' npm run seed:admin
 *   ADMIN_RESET_PASSWORD=true ... npm run seed:admin      # rotate an existing admin's password
 */
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { ensureAdmin } = require('../src/admin-seed');

const config = loadConfig();
if (!config.admin.email || !config.admin.password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD first.');
  process.exit(1);
}

const db = openDatabase(config.dbPath);
try {
  const result = ensureAdmin(db, config.admin, { resetPassword: process.env.ADMIN_RESET_PASSWORD === 'true' });
  console.log(`Admin ${result.email}: ${result.status}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
