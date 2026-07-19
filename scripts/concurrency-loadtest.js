#!/usr/bin/env node
/**
 * Buff Olympics — slot sign-up concurrency load test.
 *
 * Proves the atomic capacity guard: it creates a throwaway game with ONE slot
 * of capacity CAP, spins up N test players on the same tribe, fires all N
 * "Join" requests at that single slot SIMULTANEOUSLY, and asserts that EXACTLY
 * CAP land and the other (N − CAP) get a clean "slot just filled up" 409 — no
 * overselling. Then it cleans up after itself (deletes the test game, its
 * sign-ups, and every test player), so it leaves no residue in the event data.
 *
 * Safe to run against the live deployment, but ideally run it BEFORE real
 * sign-ups open, and while Event mode is "Sign-Up" (not Game Day).
 *
 * Requires Node 18+ (built-in fetch). No npm install needed.
 *
 * Usage:
 *   BASE_URL="https://buffolympics-swa.azurestaticapps.net" \
 *   ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
 *   node scripts/concurrency-loadtest.js
 *
 * Optional env: N (default 20 racers), CAP (default 3 seats).
 *   TEAM_SIZE — set ≥2 to test the TEAM sign-up path (migration 011): the
 *   throwaway game gets that team size, every racer joins Team 1 of a
 *   one-team slot, and exactly TEAM_SIZE must land. This exercises the team
 *   guard's result handling too (a driver-level recordset bug once made every
 *   team join answer "filled up" while still inserting).
 */

const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const N = parseInt(process.env.N || '20', 10);
const TEAM_SIZE = parseInt(process.env.TEAM_SIZE || '0', 10);
// Team mode: one team of TEAM_SIZE — the cap IS the team size.
const CAP = TEAM_SIZE >= 2 ? TEAM_SIZE : parseInt(process.env.CAP || '3', 10);

if (!BASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set BASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD env vars. See the header of this file.');
  process.exit(2);
}

const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(BASE_URL + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Auth-Token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
};

const stamp = Date.now();
const marker = `zzloadtest-${stamp}`;

async function main() {
  console.log(`\n▶ Concurrency load test against ${BASE_URL}`);
  console.log(`  ${N} simultaneous players racing for a slot with ${CAP} seats.\n`);

  // 1) Admin sign-in.
  const admin = await api('/auth/signin', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200 || !admin.json?.token) throw new Error(`Admin sign-in failed (${admin.status}): ${JSON.stringify(admin.json)}`);
  const adminToken = admin.json.token;
  if (!admin.json.user?.isAdmin) throw new Error('That account is not an admin — needed to create/clean up the test game and users.');

  // 2) Guard: sign-ups must be open.
  const boot = await api('/bootstrap', { token: adminToken });
  const mode = boot.json?.settings?.eventMode;
  if (mode !== 'signup') throw new Error(`Event mode is "${mode}", so sign-ups are locked. Flip Admin → Event mode back to Sign-Up and retry.`);

  const testUsers = [];   // { id, token, email }
  let gameId = null;

  try {
    // 3) Create a throwaway game + one capped slot (Buffalo only).
    const gName = `ZZ Load Test ${stamp}`;
    const addG = await api('/ac/games', { method: 'POST', token: adminToken, body: { action: 'addGame', name: gName, timeLabel: 'Test', needsRef: false, openPlay: false } });
    if (addG.status !== 200) throw new Error(`addGame failed (${addG.status}): ${JSON.stringify(addG.json)}`);
    gameId = addG.json.id;
    console.log(`  ✓ created test game "${gName}" (${gameId})`);

    if (TEAM_SIZE >= 2) {
      const up = await api('/ac/games', { method: 'POST', token: adminToken, body: { action: 'updateGame', gameId, teamSize: TEAM_SIZE } });
      if (up.status !== 200) throw new Error(`updateGame teamSize failed (${up.status}): ${JSON.stringify(up.json)}`);
      if (up.json && up.json.teamSizeSaved === false) throw new Error('team_size did not save — run migration 011 first, then retry TEAM_SIZE mode.');
      console.log(`  ✓ team mode: teams of ${TEAM_SIZE} (racers all join Team 1)`);
    }

    const addS = await api('/ac/games', { method: 'POST', token: adminToken, body: { action: 'addSlot', gameId, startMin: 720, label: '12:00 PM', capBuffalo: CAP, capRoadhouse: 0 } });
    if (addS.status !== 200) throw new Error(`addSlot failed (${addS.status}): ${JSON.stringify(addS.json)}`);

    // Find the slot id via the admin overview.
    const ov = await api('/ac-overview', { token: adminToken });
    const g = (ov.json?.gamesCatalog || []).find(x => x.id === gameId);
    const slot = g && (g.slots || [])[0];
    if (!slot) throw new Error('Could not find the test slot after creating it.');
    const slotId = slot.id;
    console.log(`  ✓ created slot ${slotId} with Buffalo cap ${CAP}\n`);

    // 4) Create N Buffalo test players.
    console.log(`  … creating ${N} test players`);
    for (let i = 0; i < N; i++) {
      const email = `${marker}-${i}@example.com`;
      const r = await api('/auth/signup', {
        method: 'POST',
        body: { firstName: 'Load', lastName: `Test${i}`, email, password: 'LoadTest!12345', team: 'buffalo', shirtSize: 'M', years: '1st', songRequest: '' },
      });
      if (r.status !== 200 || !r.json?.token) throw new Error(`signup ${i} failed (${r.status}): ${JSON.stringify(r.json)}`);
      testUsers.push({ id: r.json.user.id, token: r.json.token, email });
    }
    console.log(`  ✓ ${testUsers.length} players ready\n`);

    // 5) THE RACE — fire every Join in one synchronous burst.
    console.log(`  ⚡ firing ${N} simultaneous Join requests at slot ${slotId}…`);
    const joinBody = TEAM_SIZE >= 2 ? { slotId, teamNo: 1 } : { slotId };
    const promises = testUsers.map(u => api('/signups', { method: 'POST', token: u.token, body: joinBody }));
    const results = await Promise.allSettled(promises);

    // 6) Tally.
    let ok = 0, full = 0, other = 0;
    const otherDetails = [];
    for (const res of results) {
      if (res.status !== 'fulfilled') { other++; otherDetails.push(String(res.reason)); continue; }
      const { status, json } = res.value;
      if (status === 200 && json?.bootstrap) ok++;
      else if (status === 409 && /fill|full/i.test(json?.error || '')) full++;
      else { other++; otherDetails.push(`status ${status}: ${JSON.stringify(json)}`); }
    }

    // 7) Cross-check the DB's own count.
    const ov2 = await api('/ac-overview', { token: adminToken });
    const g2 = (ov2.json?.gamesCatalog || []).find(x => x.id === gameId);
    const dbCount = g2 && g2.slots[0] ? g2.slots[0].nBuffalo : '?';

    console.log(`\n  ── results ─────────────────────────────`);
    console.log(`  got in (200)          : ${ok}`);
    console.log(`  turned away "full" 409: ${full}`);
    console.log(`  unexpected            : ${other}`);
    if (otherDetails.length) otherDetails.slice(0, 5).forEach(d => console.log(`      • ${d}`));
    console.log(`  slot count in the DB  : ${dbCount}`);
    console.log(`  ────────────────────────────────────────`);

    const pass = ok === CAP && full === (N - CAP) && other === 0 && dbCount === CAP;
    if (pass) {
      console.log(`\n  ✅ PASS — exactly ${CAP} landed, ${N - CAP} cleanly turned away, DB agrees. No oversell.\n`);
    } else {
      console.log(`\n  ❌ FAIL — expected ${CAP} in / ${N - CAP} full / 0 unexpected / DB=${CAP}.`);
      console.log(`     If "got in" > cap, the slot was oversold (race not held).\n`);
    }
    process.exitCode = pass ? 0 : 1;
  } finally {
    // 8) Cleanup — always, even on failure.
    console.log('  … cleaning up');
    if (gameId) {
      const r = await api('/ac/games', { method: 'POST', token: adminToken, body: { action: 'removeGame', gameId } });
      console.log(`  ${r.status === 200 ? '✓' : '✗'} removed test game (drops its slot + sign-ups)`);
    }
    let removed = 0;
    for (const u of testUsers) {
      const r = await api('/ac/people', { method: 'POST', token: adminToken, body: { action: 'removeUser', userId: u.id } });
      if (r.status === 200) removed++;
    }
    console.log(`  ✓ removed ${removed}/${testUsers.length} test players`);
    console.log('  done.\n');
  }
}

main().catch(err => {
  console.error('\n  ❌ ERROR:', err.message, '\n');
  process.exit(1);
});
