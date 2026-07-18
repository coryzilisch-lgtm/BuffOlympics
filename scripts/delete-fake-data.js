#!/usr/bin/env node
/**
 * Buff Olympics — delete the fake accounts created by seed-fake-data.js.
 *
 * Reads the manifest (scripts/.fake-accounts.json) that seed-fake-data.js wrote
 * and removes exactly those accounts via the admin removeUser action
 * (POST /api/ac/people {action:'removeUser'}) — which also drops their sign-ups,
 * dip/relay entries and ref assignments. It only ever touches ids in that
 * manifest, so real players are never at risk.
 *
 * removeUser KEEPS logged bo_results rows. If you ran the seed with SCORE=1 (or
 * practised reffing) and want the practice scores gone too, pass RESET_SCORES=1
 * — this clears ALL logged scores (real and fake) and re-seals the board, so
 * only use it on pre-event test data.
 *
 * Requires Node 18+ (built-in fetch). No npm install needed.
 *
 * Usage:
 *   BASE_URL="https://buffolympics-swa.azurestaticapps.net" \
 *   ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
 *   node scripts/delete-fake-data.js
 *
 * Optional env:
 *   RESET_SCORES  "1" to ALSO wipe every logged score and re-seal (default off)
 */

const fs = require('fs');
const path = require('path');

// Accept BASE_URL with or without a scheme (default to https:// so fetch can parse it).
let BASE_URL = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
if (BASE_URL && !/^https?:\/\//i.test(BASE_URL)) BASE_URL = 'https://' + BASE_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const RESET_SCORES = process.env.RESET_SCORES === '1';

const MANIFEST = path.join(__dirname, '.fake-accounts.json');

if (!BASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set BASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD env vars. See the header of this file.');
  process.exit(2);
}

const api = async (p, { method = 'GET', token, body } = {}) => {
  const res = await fetch(BASE_URL + '/api' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
};

async function main() {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
  catch { console.log(`\n  Nothing to do — no manifest at ${MANIFEST}. (Seed hasn't been run, or it's already cleaned up.)\n`); return; }

  const users = manifest.users || [];
  if (!users.length) { console.log('\n  Manifest is empty — nothing to delete.\n'); fs.rmSync(MANIFEST, { force: true }); return; }

  console.log(`\n▶ Deleting ${users.length} fake accounts against ${BASE_URL}\n`);

  const admin = await api('/auth/signin', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200 || !admin.json?.token) throw new Error(`Admin sign-in failed (${admin.status}): ${JSON.stringify(admin.json)}`);
  const adminToken = admin.json.token;
  if (!admin.json.user?.isAdmin) throw new Error('That account is not an admin — needed to remove users.');

  let removed = 0;
  const remaining = [];
  for (const u of users) {
    const r = await api('/ac/people', { method: 'POST', token: adminToken, body: { action: 'removeUser', userId: u.id } });
    if (r.status === 200) { removed++; }
    else if (r.status === 404) { /* already gone — treat as success */ removed++; }
    else { remaining.push(u); console.log(`  ✗ could not remove ${u.email} (id ${u.id}): ${r.status} ${JSON.stringify(r.json)}`); }
  }
  console.log(`  ✓ removed ${removed}/${users.length} fake players`);

  // Update or clear the manifest to reflect what's left.
  if (remaining.length) { manifest.users = remaining; fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2)); console.log(`  … ${remaining.length} left in the manifest to retry.`); }
  else { fs.rmSync(MANIFEST, { force: true }); console.log('  ✓ manifest cleared.'); }

  if (RESET_SCORES) {
    console.log('\n  … RESET_SCORES=1 — wiping ALL logged scores and re-sealing the board');
    const r = await api('/ac/reset-scores', { method: 'POST', token: adminToken, body: { confirm: 'RESET' } });
    console.log(`  ${r.status === 200 ? '✓ scores cleared' : `✗ reset failed (${r.status}): ${JSON.stringify(r.json)}`}`);
  }

  console.log('\n  ✅ done.\n');
}

main().catch(err => {
  console.error('\n  ❌ ERROR:', err.message, '\n');
  process.exit(1);
});
