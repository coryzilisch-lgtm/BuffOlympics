// Public event-program OKF/Frictionless Data package: games, time slots,
// bracket structure, the day's schedule, and relay legs — the STATIC
// "what/when" half of the event, safe to publish openly.
//
// Deliberately excludes anything sealed or personal: sign-ups/rosters, live
// slot headcounts, Dip Off entries, results/scores, ref assignments, the ref
// join code, and all participant names. Those live in bootstrap/ac-overview,
// not here.
//
// Row data is built from the SAME cached ROSTER block bootstrap.js already
// shares across every viewer (loadRosterBlock, ~120s TTL) — GET /api/datapackage
// costs nothing beyond static schema, and GET /api/datapackage-file only adds
// DB load on a cold cache, same as any other page load already would.

// ── resource schema definitions (shared by the live endpoints) ─────────────

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
  },
  {
    name: 'bracket-rounds',
    description: 'Editable bracket-path rounds shown to players/refs ahead of the structured bracket engine.',
    fields: [
      { name: 'gameId', type: 'string' },
      { name: 'sort', type: 'integer', description: 'Display order within the game.' },
      { name: 'timeLabel', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'detail', type: 'string' },
      { name: 'team', type: 'string', description: "'buffalo' | 'roadhouse' | 'both'." },
    ],
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
  },
];

// ── row builders — read straight off the cached roster block shape ─────────

function gamesRows(roster) {
  const { gamesR, gameTypeById, teamSizeById, winPointsById, roundPointsById } = roster;
  return gamesR.recordset.map(g => {
    const gt = gameTypeById[g.id] || {};
    return {
      id: g.id,
      name: g.name,
      venue: g.venue,
      runtimeLabel: g.time_label || '',
      openPlay: !!g.open_play,
      needsRef: !!g.needs_ref,
      headToHead: gt.headToHead !== undefined ? gt.headToHead : !g.open_play,
      isBracket: !!gt.isBracket,
      teamSize: (teamSizeById[g.id] && teamSizeById[g.id] >= 2) ? teamSizeById[g.id] : 1,
      winPoints: winPointsById[g.id] != null ? winPointsById[g.id] : 10,
      roundPoints: roundPointsById[g.id] != null ? roundPointsById[g.id] : 0,
      players: g.players || '',
      pointsLabel: g.points_label || '',
      descr: g.descr || '',
      inventory: g.inventory || '',
    };
  });
}

function gameSlotsRows(roster) {
  const { slotsR, slotBracketById } = roster;
  return slotsR.recordset.map(s => {
    const b = slotBracketById[s.id] || {};
    return {
      id: s.id, gameId: s.game_id, startMin: s.start_min, label: s.label,
      capBuffalo: s.cap_buffalo, capRoadhouse: s.cap_roadhouse,
      roundNo: b.roundNo ?? null, lane: b.lane || null,
    };
  });
}

function bracketRoundsRows(roster) {
  const { bracketRoundsByGame } = roster;
  return Object.keys(bracketRoundsByGame).flatMap(gameId =>
    bracketRoundsByGame[gameId].map((r, i) => ({
      gameId, sort: i, timeLabel: r.time, name: r.name, detail: r.detail, team: r.team,
    })));
}

function scheduleRows(roster) {
  const { scheduleR, schedEndById } = roster;
  return scheduleR.recordset.map(r => ({
    id: r.id, timeLabel: r.time_label, ampm: r.ampm,
    endLabel: (schedEndById[r.id] || {}).endLabel || '', endAmpm: (schedEndById[r.id] || {}).endAmpm || '',
    title: r.title, place: r.place, kind: r.kind,
  }));
}

function relayLegsRows(roster) {
  const { legsR } = roster;
  return legsR.recordset.map(l => ({ id: l.id, name: l.name, cap: l.cap, desc: l.descr }));
}

const ROW_BUILDERS = {
  'games': gamesRows,
  'game-slots': gameSlotsRows,
  'bracket-rounds': bracketRoundsRows,
  'schedule': scheduleRows,
  'relay-legs': relayLegsRows,
};

function buildResourceRows(resourceName, roster) {
  const builder = ROW_BUILDERS[resourceName];
  return builder ? builder(roster) : null;
}

// ── CSV encoding (RFC 4180) ─────────────────────────────────────────────────

function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, fields) {
  const header = fields.map(f => f.name).join(',');
  const lines = rows.map(row => fields.map(f => csvField(row[f.name])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

module.exports = { RESOURCES, buildResourceRows, toCsv, csvField };
