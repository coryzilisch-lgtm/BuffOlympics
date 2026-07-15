#!/usr/bin/env node
/**
 * Buff Olympics — realistic crowd load test.
 *
 * The sibling script (concurrency-loadtest.js) proves the ATOMIC GUARD on a
 * single over-subscribed slot. THIS script proves the SYSTEM holds up under a
 * realistic crowd: it simulates the two moments that actually stress the small
 * Fabric F2 capacity —
 *
 *   Phase A — READ STAMPEDE  : every phone opens the app at once (event start,
 *                              or the Closing-Ceremony score reveal). N
 *                              simultaneous GET /api/bootstrap calls.
 *   Phase B — SIGN-UP BURST  : the "sign-ups are open!" rush — a slice of the
 *                              crowd taps Join within the same few seconds.
 *                              N simultaneous POST /api/signups, spread across
 *                              many test slots (parallel write throughput, not
 *                              lock contention — that's the other script).
 *   Phase C — SUSTAINED MIX  : everyone polling bootstrap on the real 60s
 *                              cadence for a while, with a trickle of sign-up
 *                              churn, to catch capacity throttling that only
 *                              shows up under sustained pressure.
 *
 * It reports latency percentiles (p50/p95/p99/max), throughput, and an
 * error/throttle breakdown for each phase, then DELETES every test user and the
 * test game it created — leaving zero residue in the event data. All writes go
 * into a throwaway game, so no real rosters or scores are touched.
 *
 * Run it BEFORE real sign-ups open, with Event mode = "Sign-Up", while watching
 * the Microsoft Fabric Capacity Metrics app in the portal. See docs/LOADTEST.md.
 *
 * Requires Node 18+ (built-in fetch). No npm install needed.
 *
 * Usage:
 *   BASE_URL="https://buffolympics-swa.azurestaticapps.net" \
 *   ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
 *   node scripts/loadtest-crowd.js
 *
 * Optional env:
 *   USERS         number of simulated phones            (default 200)
 *   SLOTS         test slots to spread sign-ups across  (default 25)
 *   STAMPEDE_ROUNDS  read-stampede repeats              (default 3)
 *   DURATION_S    sustained-mix phase length, seconds   (default 90)
 *   POLL_S        per-user poll cadence, seconds        (default 60, the real one)
 *   CHURN_MS      ms between sign-up toggles in phase C (default 400)
 *   TIMEOUT_MS    per-request timeout                   (default 15000)
 *   READ_ONLY     "1" to run only the read phases (any Event mode)  (default off)
 */

const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const USERS = parseInt(process.env.USERS || '200', 10);
const SLOTS = parseInt(process.env.SLOTS || '25', 10);
const STAMPEDE_ROUNDS = parseInt(process.env.STAMPEDE_ROUNDS || '3', 10);
const DURATION_S = parseInt(process.env.DURATION_S || '90', 10);
const POLL_S = parseInt(process.env.POLL_S || '60', 10);
const CHURN_MS = parseInt(process.env.CHURN_MS || '400', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '15000', 10);
const READ_ONLY = process.env.READ_ONLY === '1';

if (!BASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set BASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD env vars. See the header of this file.');
  process.exit(2);
}

const stamp = Date.now();
const marker = `zzcrowd-${stamp}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// fetch with a timeout + timing. Returns { status, json, ms, err }. A network
// error or timeout comes back as status 0 with an `err` tag, never throws.
async function timedApi(path, { method = 'GET', token, body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(BASE_URL + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, json: null, ms: Date.now() - started, err: e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(t);
  }
}

// ── stats helpers ──────────────────────────────────────────────────────────
function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}
function summarize(label, samples) {
  // samples: array of { status, ms, err }
  const lat = samples.map(s => s.ms).sort((a, b) => a - b);
  const ok = samples.filter(s => s.status >= 200 && s.status < 300).length;
  const c4 = samples.filter(s => s.status >= 400 && s.status < 500).length;   // includes 409 "full"
  const c429 = samples.filter(s => s.status === 429).length;
  const c5 = samples.filter(s => s.status >= 500).length;
  const timeouts = samples.filter(s => s.err === 'timeout').length;
  const neterr = samples.filter(s => s.err === 'network').length;
  const throttleish = c429 + c5 + timeouts;                                   // the "capacity is hurting" bucket
  console.log(`\n  ── ${label} ─────────────────────────────`);
  console.log(`  requests            : ${samples.length}`);
  console.log(`  ok (2xx)            : ${ok}`);
  console.log(`  4xx (incl. 409 full): ${c4}`);
  console.log(`  429 throttled       : ${c429}`);
  console.log(`  5xx server errors   : ${c5}`);
  console.log(`  timeouts / network  : ${timeouts} / ${neterr}`);
  console.log(`  latency p50/p95/p99 : ${pct(lat,50)} / ${pct(lat,95)} / ${pct(lat,99)} ms`);
  console.log(`  latency max         : ${lat[lat.length - 1] || 0} ms`);
  return { count: samples.length, ok, c4, c429, c5, timeouts, neterr, throttleish, p95: pct(lat, 95), p99: pct(lat, 99) };
}

async function main() {
  console.log(`\n▶ Crowd load test against ${BASE_URL}`);
  console.log(`  ${USERS} simulated phones · ${READ_ONLY ? 'READ-ONLY' : `${SLOTS} test slots`} · timeout ${TIMEOUT_MS}ms\n`);

  const admin = await timedApi('/auth/signin', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (admin.status !== 200 || !admin.json?.token) throw new Error(`Admin sign-in failed (${admin.status}): ${JSON.stringify(admin.json)}`);
  const adminToken = admin.json.token;
  if (!admin.json.user?.isAdmin) throw new Error('That account is not an admin — needed to create/clean up test data.');

  const boot = await timedApi('/bootstrap', { token: adminToken });
  const mode = boot.json?.settings?.eventMode;
  if (!READ_ONLY && mode !== 'signup') {
    throw new Error(`Event mode is "${mode}", so sign-ups are locked (Phase B/C need writes). Flip Admin → Event mode to Sign-Up, or run with READ_ONLY=1.`);
  }

  const testUsers = [];   // { id, token, team }
  let gameId = null;
  const phaseStats = {};

  try {
    // ── Setup: throwaway game + generously-capped slots (only if we write) ──
    let slotIds = [];
    if (!READ_ONLY) {
      const gName = `ZZ Crowd Test ${stamp}`;
      const addG = await timedApi('/ac/games', { method: 'POST', token: adminToken, body: { action: 'addGame', name: gName, timeLabel: 'Test', needsRef: false, openPlay: false } });
      if (addG.status !== 200) throw new Error(`addGame failed (${addG.status}): ${JSON.stringify(addG.json)}`);
      gameId = addG.json.id;
      console.log(`  ✓ created test game "${gName}" (${gameId})`);
      // Caps set so the whole crowd fits (this is a throughput test, not a
      // capacity-guard test) — spread across SLOTS distinct rows so writes run
      // in parallel instead of serializing on one locked row.
      const bigCap = Math.max(USERS, 50);
      for (let i = 0; i < SLOTS; i++) {
        const r = await timedApi('/ac/games', { method: 'POST', token: adminToken, body: { action: 'addSlot', gameId, startMin: 600 + i, label: `slot ${i}`, capBuffalo: bigCap, capRoadhouse: bigCap } });
        if (r.status !== 200) throw new Error(`addSlot ${i} failed (${r.status}): ${JSON.stringify(r.json)}`);
      }
      const ov = await timedApi('/ac-overview', { token: adminToken });
      const g = (ov.json?.gamesCatalog || []).find(x => x.id === gameId);
      slotIds = (g?.slots || []).map(s => s.id);
      if (slotIds.length !== SLOTS) throw new Error(`expected ${SLOTS} slots, found ${slotIds.length}`);
      console.log(`  ✓ created ${SLOTS} slots (cap ${bigCap}/tribe)\n`);
    }

    // ── Create N test players, split across tribes ──
    console.log(`  … creating ${USERS} test players`);
    for (let i = 0; i < USERS; i++) {
      const team = i % 2 ? 'roadhouse' : 'buffalo';
      const email = `${marker}-${i}@example.com`;
      const r = await timedApi('/auth/signup', {
        method: 'POST',
        body: { firstName: 'Load', lastName: `Crowd${i}`, email, password: 'LoadTest!12345', team, shirtSize: 'M', years: '1st', songRequest: '' },
      });
      if (r.status !== 200 || !r.json?.token) throw new Error(`signup ${i} failed (${r.status}): ${JSON.stringify(r.json)}`);
      testUsers.push({ id: r.json.user.id, token: r.json.token, team, slotId: slotIds.length ? slotIds[i % slotIds.length] : null });
    }
    console.log(`  ✓ ${testUsers.length} players ready`);

    // ── Phase A — READ STAMPEDE ──
    for (let round = 1; round <= STAMPEDE_ROUNDS; round++) {
      console.log(`\n  ⚡ Phase A round ${round}/${STAMPEDE_ROUNDS}: ${USERS} simultaneous GET /bootstrap…`);
      const res = await Promise.all(testUsers.map(u => timedApi('/bootstrap', { token: u.token })));
      phaseStats[`stampede-${round}`] = summarize(`Phase A · read stampede (round ${round})`, res);
    }

    if (!READ_ONLY) {
      // ── Phase B — SIGN-UP BURST ──
      console.log(`\n  ⚡ Phase B: ${USERS} simultaneous POST /signups (spread across ${SLOTS} slots)…`);
      const burst = await Promise.all(testUsers.map(u => timedApi('/signups', { method: 'POST', token: u.token, body: { slotId: u.slotId } })));
      phaseStats['signup-burst'] = summarize('Phase B · sign-up burst', burst);

      // ── Phase C — SUSTAINED MIX ──
      console.log(`\n  ⏱ Phase C: sustained poll (${POLL_S}s cadence) + churn for ${DURATION_S}s…`);
      const readSamples = [];
      const churnSamples = [];
      const endAt = Date.now() + DURATION_S * 1000;
      // Each user polls on the real cadence, jittered so they don't sync up.
      const pollers = testUsers.map(async (u) => {
        await sleep(Math.floor(Math.random() * POLL_S * 1000));
        while (Date.now() < endAt) {
          readSamples.push(await timedApi('/bootstrap', { token: u.token }));
          await sleep(POLL_S * 1000);
        }
      });
      // Background write churn: random users toggle their sign-up (DELETE→POST)
      // to keep the shared-bootstrap cache busting under sustained read load.
      const churner = (async () => {
        while (Date.now() < endAt) {
          const u = testUsers[Math.floor(Math.random() * testUsers.length)];
          const del = await timedApi('/signups/' + u.slotId, { method: 'DELETE', token: u.token });
          churnSamples.push(del);
          const add = await timedApi('/signups', { method: 'POST', token: u.token, body: { slotId: u.slotId } });
          churnSamples.push(add);
          await sleep(CHURN_MS);
        }
      })();
      await Promise.all([...pollers, churner]);
      phaseStats['sustained-read'] = summarize('Phase C · sustained polling reads', readSamples);
      phaseStats['sustained-churn'] = summarize('Phase C · sustained write churn', churnSamples);
    }

    // ── Verdict ──
    console.log(`\n  ══════════════════════════════════════════`);
    const allBad = Object.values(phaseStats).reduce((a, s) => a + s.throttleish, 0);
    const worstP95 = Math.max(...Object.values(phaseStats).map(s => s.p95));
    const worstP99 = Math.max(...Object.values(phaseStats).map(s => s.p99));
    console.log(`  worst p95 latency   : ${worstP95} ms`);
    console.log(`  worst p99 latency   : ${worstP99} ms`);
    console.log(`  throttle-ish events : ${allBad}  (429 + 5xx + timeouts)`);
    // Thresholds tuned for the 100–250 range on Fabric F2. Adjust in the guide.
    const pass = allBad === 0 && worstP95 < 3000 && worstP99 < 8000;
    if (pass) {
      console.log(`\n  ✅ HEALTHY — no throttling, p95 under 3s. F2 handled the crowd.`);
    } else {
      console.log(`\n  ⚠️  STRAINED — see docs/LOADTEST.md "If it strains" for the tuning levers.`);
      if (allBad) console.log(`     ${allBad} requests were throttled / errored / timed out.`);
      if (worstP95 >= 3000) console.log(`     p95 latency ${worstP95}ms suggests the capacity is saturating.`);
    }
    console.log(`  ══════════════════════════════════════════`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    // ── Cleanup — always, even on failure ──
    console.log(`\n  … cleaning up`);
    if (gameId) {
      const r = await timedApi('/ac/games', { method: 'POST', token: adminToken, body: { action: 'removeGame', gameId } });
      console.log(`  ${r.status === 200 ? '✓' : '✗'} removed test game (drops its slots + sign-ups)`);
    }
    let removed = 0;
    for (const u of testUsers) {
      const r = await timedApi('/ac/people', { method: 'POST', token: adminToken, body: { action: 'removeUser', userId: u.id } });
      if (r.status === 200) removed++;
    }
    console.log(`  ✓ removed ${removed}/${testUsers.length} test players`);
    console.log(`  done.\n`);
  }
}

main().catch(err => {
  console.error('\n  ❌ ERROR:', err.message, '\n');
  process.exit(1);
});
