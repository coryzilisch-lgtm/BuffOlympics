#!/usr/bin/env node
/**
 * Buff Olympics — public event-program OKF Data Package builder.
 *
 * Exports the STATIC "what/when" half of the event — games, time slots,
 * bracket structure, the day's schedule, and relay legs — as an Open
 * Knowledge Foundation "Data Package" (datapackage.json + CSV resources,
 * per https://dataprotocols.org/data-package/ / Frictionless Data).
 *
 * Deliberately EXCLUDES anything sealed or personal: no sign-ups/rosters,
 * no Dip Off entries, no results/scores, no people, no ref join code. Those
 * are runtime/participant data, not the published event program.
 *
 * Requires Node 18+ (built-in fetch). No npm install needed.
 *
 * Usage:
 *   BASE_URL="https://buffolympics-swa.azurestaticapps.net" \
 *   ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
 *   node scripts/build-datapackage.js
 *
 * Optional env: OUT_DIR (default "./dist/datapackage").
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OUT_DIR = process.env.OUT_DIR || path.join('.', 'dist', 'datapackage');

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

// Minimal RFC 4180 CSV encoding — quote whenever the field contains a comma,
// quote, or newline; double up any internal quotes. null/undefined -> ''.
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? String(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, fields) {
  const header = fields.map(f => f.name).join(',');
  const lines = rows.map(row => fields.map(f => csvField(row[f.name])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

// ── resource definitions: name, schema fields, row extractor ────────────────

const RESOURCES = [
  {
    name: 'games',
    description: 'The game catalog: rules, venue, scoring type, and points.',
    fields: [
      { name: 'id', type: 'string', description: 'Stable game id (also the results-matching key upstream).' },
      { name: 'name', type: 'string' },
      { name: 'venue', type: 'string' },
      { name: 'runtimeLabel', type: 'string', description: 'Free-text time-of-day label shown to players.' },
      { name: 'openPlay', type: 'boolean', description: 'True = walk-up game (no fixed matchup time).' },
      { name: 'needsRef', type: 'boolean' },
      { name: 'headToHead', type: 'boolean', description: 'True = winner-picker scoring; false = a number typed per team.' },
      { name: 'isBracket', type: 'boolean' },
      { name: 'teamSize', type: 'integer', description: 'Players per team; 1 = individual game.' },
      { name: 'winPoints', type: 'integer', description: 'Points a head-to-head/championship win awards.' },
      { name: 'roundPoints', type: 'integer', description: 'Points a single bracket-round win awards.' },
      { name: 'players', type: 'string', description: 'Free-text player-count description.' },
      { name: 'pointsLabel', type: 'string', description: 'Free-text scoring description.' },
      { name: 'descr', type: 'string', description: 'Rules / how-to-play.' },
      { name: 'inventory', type: 'string', description: 'Equipment needed.' },
    ],
    rows: (ov) => ov.gamesCatalog.map(g => ({
      id: g.id, name: g.name, venue: g.venue, runtimeLabel: g.runtimeLabel,
      openPlay: g.openPlay, needsRef: g.needsRef, headToHead: g.headToHead, isBracket: g.isBracket,
      teamSize: g.teamSize, winPoints: g.winPoints, roundPoints: g.roundPoints,
      players: g.players, pointsLabel: g.pointsLabel, descr: g.descr, inventory: g.inventory,
    })),
  },
  {
    name: 'game-slots',
    description: 'Time slots each game runs, with per-tribe capacity and bracket-match placement. No participant rosters or headcounts.',
    fields: [
      { name: 'id', type: 'integer' },
      { name: 'gameId', type: 'string' },
      { name: 'startMin', type: 'integer', description: 'Minutes since midnight.' },
      { name: 'label', type: 'string', description: 'Display time, e.g. "1:30 PM".' },
      { name: 'capBuffalo', type: 'integer' },
      { name: 'capRoadhouse', type: 'integer' },
      { name: 'roundNo', type: 'integer', description: 'Bracket round number, if this slot is a structured bracket match.' },
      { name: 'lane', type: 'string', description: "'buffalo' | 'roadhouse' | 'final', for structured bracket matches." },
    ],
    rows: (ov) => ov.gamesCatalog.flatMap(g => g.slots.map(s => ({
      id: s.id, gameId: g.id, startMin: s.startMin, label: s.label,
      capBuffalo: s.capBuffalo, capRoadhouse: s.capRoadhouse, roundNo: s.roundNo, lane: s.lane,
    }))),
  },
  {
    name: 'bracket-rounds',
    description: 'Editable bracket-path rounds shown to players/refs ahead of the structured bracket engine.',
    fields: [
      { name: 'id', type: 'integer' },
      { name: 'gameId', type: 'string' },
      { name: 'sort', type: 'integer', description: 'Display order within the game.' },
      { name: 'timeLabel', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'detail', type: 'string' },
      { name: 'team', type: 'string', description: "'buffalo' | 'roadhouse' | 'both'." },
    ],
    rows: (ov) => ov.gamesCatalog.flatMap(g => g.bracketRounds.map((r, i) => ({
      id: r.id, gameId: g.id, sort: i, timeLabel: r.time, name: r.name, detail: r.detail, team: r.team,
    }))),
  },
  {
    name: 'schedule',
    description: "The day's shared schedule blocks (arrivals, ceremonies, meals, …).",
    fields: [
      { name: 'id', type: 'integer' },
      { name: 'timeLabel', type: 'string' },
      { name: 'ampm', type: 'string' },
      { name: 'endLabel', type: 'string' },
      { name: 'endAmpm', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'place', type: 'string' },
      { name: 'kind', type: 'string' },
    ],
    rows: (ov) => ov.schedule.map(s => ({
      id: s.id, timeLabel: s.timeLabel, ampm: s.ampm, endLabel: s.endLabel, endAmpm: s.endAmpm,
      title: s.title, place: s.place, kind: s.kind,
    })),
  },
  {
    name: 'relay-legs',
    description: 'The relay race legs: name, capacity, and description. Participant rosters are excluded.',
    fields: [
      { name: 'id', type: 'integer' },
      { name: 'name', type: 'string' },
      { name: 'cap', type: 'integer' },
      { name: 'desc', type: 'string' },
    ],
    rows: (ov) => ov.relay.legs.map(l => ({ id: l.id, name: l.name, cap: l.cap, desc: l.desc })),
  },
];

async function main() {
  console.log(`\n▶ Building OKF data package from ${BASE_URL}\n`);

  const signin = await api('/auth/signin', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (signin.status !== 200 || !signin.json?.token) throw new Error(`Sign-in failed (${signin.status}): ${JSON.stringify(signin.json)}`);
  if (!signin.json.user?.isAdmin) throw new Error('That account is not an admin — ac-overview needs admin access for the full game catalog.');
  const token = signin.json.token;

  const ov = await api('/ac-overview', { token });
  if (ov.status !== 200) throw new Error(`ac-overview failed (${ov.status}): ${JSON.stringify(ov.json)}`);
  const overview = ov.json;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const resourceDescriptors = RESOURCES.map(r => {
    const rows = r.rows(overview);
    const csv = toCsv(rows, r.fields);
    const fileName = `${r.name}.csv`;
    fs.writeFileSync(path.join(OUT_DIR, fileName), csv, 'utf-8');
    console.log(`  ✓ ${fileName} (${rows.length} rows)`);
    return {
      name: r.name,
      path: fileName,
      profile: 'tabular-data-resource',
      format: 'csv',
      mediatype: 'text/csv',
      encoding: 'utf-8',
      description: r.description,
      schema: { fields: r.fields.map(({ name, type, description }) => ({ name, type, ...(description ? { description } : {}) })) },
    };
  });

  const datapackage = {
    profile: 'tabular-data-package',
    name: 'buff-olympics-program',
    title: 'Buff Olympics — The Herd Games — Event Program',
    description:
      'Public program data for Buff Olympics (August 14, 2026): the game catalog, time slots, ' +
      "bracket structure, the day's shared schedule, and relay legs. Generated from the live event " +
      'app. Does NOT include sign-ups, participant rosters, Dip Off entries, ref assignments, or ' +
      'scores — team totals stay sealed until an admin reveals them at the Closing Ceremony.',
    licenses: [
      { name: 'CC-BY-4.0', path: 'https://creativecommons.org/licenses/by/4.0/', title: 'Creative Commons Attribution 4.0 International' },
    ],
    keywords: ['buff-olympics', 'herd-games', 'event-program', 'open-data'],
    created: new Date().toISOString(),
    resources: resourceDescriptors,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'datapackage.json'), JSON.stringify(datapackage, null, 2) + '\n', 'utf-8');
  console.log(`  ✓ datapackage.json\n\n  Package written to ${OUT_DIR}\n`);
}

main().catch(err => {
  console.error('\n  ❌ ERROR:', err.message, '\n');
  process.exit(1);
});
