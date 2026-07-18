#!/usr/bin/env node
/**
 * Buff Olympics — seed fake accounts and fill every game slot.
 *
 * For dress-rehearsing the whole event before real people show up: it creates a
 * pool of fake players on both tribes, then drops them into EVERY open seat of
 * EVERY game slot so the whole board reads "full". You can then open the app,
 * flip to Game Day, go into referee mode, and practise logging scores against a
 * board that looks like a real crowd.
 *
 * How it fills: it uses the admin **fillSlot** override
 * (POST /api/ac/people {action:'fillSlot'}), which ignores per-tribe day caps,
 * time-overlap rules, and event mode. That means a small pool of fake users can
 * fill hundreds of seats, and it works whether Event mode is Sign-Up or Game Day.
 *
 * It records every account it creates in a manifest file next to this script
 * (scripts/.fake-accounts.json). The companion delete-fake-data.js reads that
 * manifest to remove exactly the accounts this script made — nothing real.
 *
 * Every fake user's email starts with the FAKE_PREFIX marker and their first
 * name is "Zztest", so they're easy to spot in Admin → People too.
 *
 * Requires Node 18+ (built-in fetch). No npm install needed.
 *
 * Usage:
 *   BASE_URL="https://buffolympics-swa.azurestaticapps.net" \
 *   ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
 *   node scripts/seed-fake-data.js
 *
 * Optional env:
 *   POOL_BUFFALO    fake Buffalo players to create        (default 30)
 *   POOL_ROADHOUSE  fake Texas Roadhouse players          (default 30)
 *   SCORE           "1" to also log a random winner per   (default off)
 *                   game (so there are scores to reveal / practise with)
 *   FAKE_PREFIX     email marker for the fakes            (default "zzfake")
 */

const fs = require('fs');
const path = require('path');

// Accept BASE_URL with or without a scheme (default to https:// so fetch can parse it).
let BASE_URL = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
if (BASE_URL && !/^https?:\/\//i.test(BASE_URL)) BASE_URL = 'https://' + BASE_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const POOL_BUFFALO = parseInt(process.env.POOL_BUFFALO || '30', 10);
const POOL_ROADHOUSE = parseInt(process.env.POOL_ROADHOUSE || '30', 10);
const SCORE = process.env.SCORE === '1';
const FAKE_PREFIX = process.env.FAKE_PREFIX || 'zzfake';

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

// A little variety so rosters don't read as a wall of identical names.
const FIRST = ['Alex', 'Sam', 'Jordan', 'Casey', 'Riley', 'Taylor', 'Morgan', 'Jamie', 'Avery', 'Quinn',
  'Reese', 'Parker', 'Drew', 'Skyler', 'Hayden', 'Rowan', 'Emerson', 'Finley', 'Sawyer', 'Charlie'];
const LAST = ['Reed', 'Lane', 'Cole', 'Ford', 'Hart', 'Vance', 'Wells', 'Pike', 'Rhodes', 'Booker',
  'Cross', 'Dean', 'Frost', 'Grove', 'Hale', 'Knox', 'Marsh', 'Nash', 'Pace', 'Quill'];

const stamp = Date.now();

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
  catch { return { users: [] }; }
}
function saveManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

async function main() {
  console.log(`\n▶ Seeding fake data against ${BASE_URL}`);
  console.log(`  ${POOL_BUFFALO} Buffalo + ${POOL_ROADHOUSE} Texas Roadhouse fake players.\n`);

  // 1) Admin sign-in.
  const admin = await api('/auth/signin', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200 || !admin.json?.token) throw new Error(`Admin sign-in failed (${admin.status}): ${JSON.stringify(admin.json)}`);
  const adminToken = admin.json.token;
  if (!admin.json.user?.isAdmin) throw new Error('That account is not an admin — needed to fill slots and clean up later.');

  const manifest = loadManifest();
  const made = [];   // { id, email, team, name }

  // 2) Create the fake player pool.
  console.log('  … creating fake players');
  const pool = { buffalo: [], roadhouse: [] };
  const plan = [['buffalo', POOL_BUFFALO], ['roadhouse', POOL_ROADHOUSE]];
  for (const [team, count] of plan) {
    for (let i = 0; i < count; i++) {
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i + team.length) % LAST.length];
      const email = `${FAKE_PREFIX}-${stamp}-${team}-${i}@example.com`;
      const r = await api('/auth/signup', {
        method: 'POST',
        body: { firstName: 'Zztest', lastName: `${first}${last}`, email, password: 'FakeSeed!12345', team, shirtSize: 'M', years: '1st', songRequest: '' },
      });
      if (r.status !== 200 || !r.json?.token) throw new Error(`signup (${team} ${i}) failed (${r.status}): ${JSON.stringify(r.json)}`);
      const rec = { id: r.json.user.id, email, team, name: r.json.user.name };
      pool[team].push(rec);
      made.push(rec);
    }
  }
  // Persist the manifest right away so a mid-run crash still leaves a delete trail.
  manifest.users.push(...made);
  saveManifest(manifest);
  console.log(`  ✓ ${made.length} fake players created (recorded in ${path.basename(MANIFEST)})\n`);

  // 3) Fill every open seat of every slot, cycling through the pool.
  const ov = await api('/ac-overview', { token: adminToken });
  const games = ov.json?.gamesCatalog || [];
  if (!games.length) throw new Error('No games found in ac-overview — is the DB seeded?');

  let filled = 0, slotsSeen = 0, gamesSeen = 0;
  const cursor = { buffalo: 0, roadhouse: 0 };

  for (const g of games) {
    const slots = g.slots || [];
    if (slots.length) gamesSeen++;
    for (const s of slots) {
      slotsSeen++;
      for (const team of ['buffalo', 'roadhouse']) {
        const cap = team === 'buffalo' ? (s.capBuffalo || 0) : (s.capRoadhouse || 0);
        const have = team === 'buffalo' ? (s.nBuffalo || 0) : (s.nRoadhouse || 0);
        const need = Math.max(0, cap - have);
        const roster = pool[team];
        if (need > 0 && roster.length < cap) {
          console.log(`  ⚠ ${g.name} · ${s.label}: needs ${cap} ${team} but pool only has ${roster.length}; raise POOL_${team.toUpperCase()}.`);
        }
        for (let k = 0; k < need && roster.length; k++) {
          const u = roster[cursor[team] % roster.length];
          cursor[team]++;
          const r = await api('/ac/people', { method: 'POST', token: adminToken, body: { action: 'fillSlot', userId: u.id, slotId: s.id } });
          if (r.status === 200) filled++;
          else if (r.status === 409) k--;   // that user was already in this slot — try the next one
          // any other status: skip quietly (cap edge, removed slot); the count reflects reality
        }
      }
    }
  }
  console.log(`  ✓ filled ${filled} seats across ${slotsSeen} slots in ${gamesSeen} games\n`);

  // 4) Optionally log a random winner per game, so there are scores to work with.
  if (SCORE) {
    console.log('  … logging a random result per game (SCORE=1)');
    let logged = 0;
    for (const g of games) {
      if (!(g.slots || []).length) continue;   // skip games nobody can be in
      const a = 5 + Math.floor(Math.random() * 20);
      const b = 5 + Math.floor(Math.random() * 20);
      const r = await api('/results', {
        method: 'POST', token: adminToken,
        body: { type: 'vs', gameName: g.name, ptsBuffalo: a, ptsRoadhouse: b, slotLabel: (g.slots[0] || {}).label || '' },
      });
      if (r.status === 200) logged++;
    }
    console.log(`  ✓ logged ${logged} results (totals stay sealed until you Reveal)\n`);
  }

  console.log('  ✅ done. Open the app to see full games; flip to Game Day to practise reffing.');
  console.log(`     When finished: node scripts/delete-fake-data.js\n`);
}

main().catch(err => {
  console.error('\n  ❌ ERROR:', err.message);
  console.error('     Partial accounts (if any) are in scripts/.fake-accounts.json — run delete-fake-data.js to clean up.\n');
  process.exit(1);
});
