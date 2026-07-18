/* Buff Olympics — SPA (vanilla JS, no build step).
   Talks to the SWA managed-Functions API in /api per docs/API.md.
   Design ported from the Claude Design mockup — inline styles are intentional. */
(() => {
'use strict';

/* ════════════════════ state ════════════════════ */
const S = {
  token: localStorage.getItem('bo_token') || null,
  boot: null,            // GET /api/bootstrap payload
  overview: null,        // GET /api/admin-board payload
  route: 'home', routeArg: null,
  loading: false, bootError: null,
  isDesk: window.innerWidth >= 940,
  // auth UI
  authView: 'signin',    // 'signin' | 'signup' | 'ref'
  refMode: 'login',      // 'login' | 'create'
  inErr: false, pwErr: false, rcErr: false, authMsg: null,
  signupTeam: null,      // tribe picked on the sign-up form
  forceTeamGate: false,
  f: { npShirt: 'M', npYears: '1st' },   // form field store (survives re-renders)
  // games UI
  cat: 'all', gameSearch: '',
  tribeTab: 'buffalo',
  videoOpen: null,       // url string
  // ref board UI
  refOpen: null, refSlot: {}, entryB: 0, entryR: 0, refWinner: null, refRound: 'round',
  refRoundSel: null,       // bracket round name being scored (round mode)
  teamScores: {},          // variable-score entry: { buffalo: n, roadhouse: n }
  soloScores: {},          // per-person variable-score entry: { 'Alex R.': n, … }
  walkSearch: '', walkPick: null, walkScore: 0, walkLog: [],
  // walk-up matchup builder (team walk-ups): picked names per side + scores
  mu: { buffalo: [], roadhouse: [] }, muSearch: { buffalo: '', roadhouse: '' }, muScores: {}, muWinner: null,
  // admin UI
  adminSection: 'people', schedView: 'list',
  adminPeek: null, adminConfirmReveal: false,
  editingId: null, editVal: '',
  historyOpenId: null,
  admGameEdit: null,     // { mode:'add'|'edit', id?, needsRef, openPlay, headToHead } — game modal
  admSlotEdit: null,     // { mode:'add'|'edit', gameId, slotId? } — slot modal
  admBracketEdit: null,  // { gameId } — bracket editor modal (rounds + intro)
  admRoundEdit: null,    // round id being edited inline in the bracket modal
  admRoundTeam: 'both',  // selected matchup for the round being edited
  admFillSlot: null,     // { slotId, gameId } — "Fill slot" search open in Games tab
  admAddSlot: null,      // { uid, gameId } — slot picker open in People tab
  admSchedEdit: null,    // schedule row id currently being edited inline
  admSchedKind: 'up',    // kind of the schedule row being edited: up|live|done
  admIdolEdit: null,     // idol clue id currently being edited inline
  admIdolAward: null,    // idol id whose "who found it?" search is open
  walkupOpen: false,     // game-day home "earn more points" walk-up expander
  busy: false,
};

/* ════════════════════ utils ════════════════════ */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function initials(name) {
  const p = String(name || '').replace(/[^A-Za-z. ]/g, '').split(' ');
  return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toUpperCase();
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function fmtClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
function slotStartLabel(slotLabel) {
  // '1:30 – 2:00 PM' -> '1:30 PM'; 'Walk up anytime' -> 'Anytime'
  const s = String(slotLabel || '');
  if (!/\d/.test(s)) return 'Anytime';
  const start = s.split('–')[0].trim();
  const ap = (s.match(/AM|PM/) || [''])[0];
  return start + (ap ? ' ' + ap : '');
}
function ytParse(url) {
  const m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
let toastTimer = null;
function toast(msg) {
  let host = document.getElementById('bo-toast-host');
  if (!host) { host = document.createElement('div'); host.id = 'bo-toast-host'; document.body.appendChild(host); }
  host.innerHTML = '<div class="bo-toast">' + esc(msg) + '</div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, 3500);
}
const chevR = (c, w, hh, sw) => '<svg width="' + (w || 9) + '" height="' + (hh || 15) + '" viewBox="0 0 9 15"><path d="M1.5 1.5L7 7.5l-5.5 6" stroke="' + c + '" stroke-width="' + (sw || 2.2) + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const chevL = (c) => '<svg width="9" height="15" viewBox="0 0 9 15"><path d="M7.5 1.5L2 7.5l5.5 6" stroke="' + c + '" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const lockSvg = (c, sz) => '<svg width="' + (sz || 22) + '" height="' + (sz || 22) + '" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><rect x="4" y="10" width="16" height="10" rx="2" stroke="' + c + '" stroke-width="2"/><path d="M7.5 10V7a4.5 4.5 0 019 0v3" stroke="' + c + '" stroke-width="2"/></svg>';
const shieldSvg = (c, sz) => '<svg width="' + (sz || 18) + '" height="' + (sz || 18) + '" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/></svg>';
const checkSvg = (c, sz, sw) => '<svg width="' + (sz || 14) + '" height="' + (sz || 14) + '" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-11" stroke="' + c + '" stroke-width="' + (sw || 2.5) + '" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const dipSvg = (c, sz) => '<svg width="' + (sz || 24) + '" height="' + (sz || 24) + '" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M4 11h16M5 11a7 7 0 0014 0M12 3v2M8 20h8" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const relaySvg = (c, sz) => '<svg width="' + (sz || 26) + '" height="' + (sz || 26) + '" viewBox="0 0 24 24" fill="none"><path d="M6 8l4 2-2 4 5 1 1 4M14 5a1.6 1.6 0 100-.01M4 20l4-4M13 12l6-2" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const clipSvg = (c, sz) => '<svg width="' + (sz || 24) + '" height="' + (sz || 24) + '" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><rect x="5" y="4" width="14" height="17" rx="2" stroke="' + c + '" stroke-width="2"/><path d="M9 4h6v3H9z" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const searchSvg = (c) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><circle cx="11" cy="11" r="7" stroke="' + c + '" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/></svg>';

/* ════════════════════ api ════════════════════ */
function setToken(t) {
  S.token = t;
  if (t) localStorage.setItem('bo_token', t);
  else localStorage.removeItem('bo_token');
}
async function api(path, opts) {
  opts = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers['X-Auth-Token'] = S.token;
  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error('Network error — check your connection.'), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  if (res.status === 401 && S.token) {
    setToken(null); S.boot = null; S.overview = null;
    render();
    throw Object.assign(new Error('Session expired — sign in again.'), { status: 401, code: 'expired' });
  }
  if (!res.ok) {
    const msg = (data && data.error) || ('Request failed (' + res.status + ')');
    throw Object.assign(new Error(msg), { status: res.status, code: data && data.error });
  }
  return data;
}
// mutations return { bootstrap } — swap it in and re-render
function applyBoot(res) {
  const b = (res && res.bootstrap) || (res && res.user ? res : null);
  if (b) { S.boot = b; S.bootError = null; }
  render();
}
async function loadBoot(silent) {
  if (!S.token) return;
  if (!silent) { S.loading = true; S.bootError = null; render(); }
  try {
    const b = await api('/bootstrap');
    S.boot = b; S.bootError = null;
  } catch (e) {
    if (e.status === 401) return;      // handled in api()
    if (!silent) S.bootError = e.message;
  }
  S.loading = false;
  render();
}
async function loadOverview(silent) {
  if (!S.token) return;
  try {
    S.overview = await api('/ac-overview');
  } catch (e) {
    if (!silent) toast(e.message);
  }
  render();
}

/* ════════════════════ theme ════════════════════ */
const TH_BUF = {
  surface: '#01182B', bar: '#011220', hero: '#00141F', panel: '#0C2D49',
  panelBorder: 'rgba(255,255,255,0.10)', line: 'rgba(255,255,255,0.09)',
  accent: '#FF5F00', accent2: '#FF7F2E', onAccent: '#011220',
  text: '#F3F7F5', sub: '#8AA7B9', tabIdle: '#5C7B91',
  dim: 'rgba(255,95,0,0.16)', glow: 'rgba(255,95,0,0.22)',
};
const TH_ROAD = {
  surface: '#161310', bar: '#0B0908', hero: '#181310', panel: '#241C14',
  panelBorder: 'rgba(245,197,24,0.22)', line: 'rgba(245,197,24,0.14)',
  accent: '#E0322E', accent2: '#F5C518', onAccent: '#FFFFFF',
  text: '#F7EFE1', sub: '#C7B393', tabIdle: '#8C7A5E',
  dim: 'rgba(224,50,46,0.20)', glow: 'rgba(224,50,46,0.34)',
};
function theme() {
  const team = S.boot && S.boot.user ? S.boot.user.team : null;
  const tIsBuf = team !== 'roadhouse';
  const th = tIsBuf ? TH_BUF : TH_ROAD;
  return {
    th, tIsBuf, team,
    A: th.accent, A2: th.accent2, on: th.onAccent, dim: th.dim, glow: th.glow,
    isBuf: team === 'buffalo', isRoad: team === 'roadhouse',
    myTeamName: team === 'roadhouse' ? 'Texas Roadhouse' : 'Buffalo',
    myTeamWord: team === 'roadhouse' ? 'Roadie' : 'Teammate',
    deskAccent: tIsBuf ? '#FF5F00' : '#E0322E',
    deskAccentOn: tIsBuf ? '#011220' : '#FFFFFF',
    deskAccentDim: tIsBuf ? '#FFF4EC' : '#FCECEC',
    deskChipBg: tIsBuf ? '#00253D' : '#241C14',
    deskChipFg: tIsBuf ? '#FF7F2E' : '#F5C518',
  };
}
function isRefUser() {
  // Only actual referees get the station board on Home/Score. Admins are NOT
  // refs — they use the player app on mobile + the Admin Center on desktop.
  const u = S.boot && S.boot.user;
  return !!(u && u.isRef);
}

/* ════════════════════ slot-based sign-up state ════════════════════ */
// Per-tribe day cap comes from the server (Buffalo 4 / TXRH 2). Fall back to 2.
function signupMax() {
  const m = S.boot && S.boot.signupMax;
  return Number.isFinite(m) ? m : 2;
}
function myTeamKey() {
  return S.boot.user.team === 'roadhouse' ? 'roadhouse' : 'buffalo';
}
function myPickCount() {
  return (S.boot.mySignups || []).length;
}
// Per-slot state for MY tribe: 'signed' | 'open' | 'full' | 'closed' | 'max' | 'conflict' | 'locked'
// Pass the game so walk-up (open_play) slots can ALLOW overlap (with a warning)
// instead of blocking it the way fixed-time games do.
function slotState(slot, g) {
  const mode = S.boot.settings.eventMode;
  const team = myTeamKey();
  const cap = team === 'buffalo' ? slot.capBuffalo : slot.capRoadhouse;
  const roster = team === 'buffalo' ? slot.buffalo : slot.roadhouse;
  const otherCap = team === 'buffalo' ? slot.capRoadhouse : slot.capBuffalo;
  const otherRoster = team === 'buffalo' ? slot.roadhouse : slot.buffalo;
  const openPlay = !!(g && g.openPlay);
  const overlaps = (S.boot.mySignups || []).some(x => x.slotId !== slot.id && Math.abs(x.startMin - slot.startMin) < 5);
  let st;
  if (slot.mine) st = 'signed';
  else if (mode === 'gameday') st = 'locked';
  else if (cap <= 0) st = 'closed';
  else if (roster.length >= cap) st = 'full';
  else if (myPickCount() >= signupMax()) st = 'max';
  else if (overlaps && !openPlay) st = 'conflict';
  else st = 'open';
  // For walk-up slots we still surface the overlap so the row can warn.
  return { st, cap, roster, otherCap, otherRoster, openPlay, overlap: openPlay && overlaps && st === 'open' };
}
// Whole-game summary for the list card. Walk-up games now carry time slots too,
// so compute spots for them as well; `openPlay`/`hasSlots` drive the badge.
function gameSummary(g) {
  const team = myTeamKey();
  const slots = g.slots || [];
  let cap = 0, filled = 0, mineLabel = null;
  for (const s of slots) {
    cap += team === 'buffalo' ? s.capBuffalo : s.capRoadhouse;
    filled += (team === 'buffalo' ? s.buffalo : s.roadhouse).length;
    if (s.mine) mineLabel = s.label;
  }
  return {
    openPlay: !!g.openPlay, hasSlots: slots.length > 0,
    cap, filled, open: Math.max(0, cap - filled), mine: !!mineLabel, mineLabel,
  };
}
// The scoring "units" in a slot for one tribe. Team games (teamSize ≥ 2, migration
// 011) → the tribe's teams (from the payload's buffaloTeams/roadhouseTeams); each
// unit is a whole team the ref scores together. Individual games → one unit per
// person. `teamNo` is set only for team units (drives the sign-up team join).
function slotUnits(slot, team) {
  const teams = team === 'buffalo' ? slot.buffaloTeams : slot.roadhouseTeams;
  if (teams && (slot.teamSize || 1) >= 2) {
    return teams.map((members, i) => ({
      team, teamNo: i + 1, members: members || [],
      key: `${team}:t${i + 1}`,
      name: (members && members.length) ? members.join(' & ') : `Team ${i + 1}`,
      label: `Team ${i + 1}`, empty: !(members && members.length),
    }));
  }
  const flat = (team === 'buffalo' ? slot.buffalo : slot.roadhouse) || [];
  return flat.map(nm => ({ team, teamNo: null, members: [nm], key: `${team}:${nm}`, name: nm, label: nm, empty: false }));
}
// Results that belong to ONE slot. Post-012 results carry slotId (exact match);
// older rows fall back to the time label — which is ambiguous when two matches
// share a time. That ambiguity is exactly what bo_results.slot_id fixes.
function resultsForSlot(results, slot) {
  return results.filter(r => r.slotId != null ? String(r.slotId) === String(slot.id) : r.slotLabel === slot.label);
}

/* ── bracket engine (migration 012) ──
   A bracket game whose slots carry round_no becomes a STRUCTURED bracket: each
   slot is a MATCH. The lowest round in a lane seeds from sign-ups; a later
   round's match is fed by the winners of the lane's previous round (in slot
   order, two per match); the championship (lane 'final') takes each tribe
   lane's last winners. Unscored feeders → the match shows "waiting". */
function slotLane(s) {
  if (s.lane) return s.lane;
  if ((s.capBuffalo || 0) > 0 && !(s.capRoadhouse || 0)) return 'buffalo';
  if ((s.capRoadhouse || 0) > 0 && !(s.capBuffalo || 0)) return 'roadhouse';
  return null;   // open to both tribes (legacy dual slot)
}
function bracketMatches(st, results) {
  const structured = (st.slots || []).filter(s => s.roundNo != null)
    .slice().sort((a, b) => (a.roundNo - b.roundNo) || (a.startMin - b.startMin) || (a.id - b.id));
  if (!structured.length) return null;
  const winnerOf = (slot) => {
    const r = resultsForSlot(results, slot).filter(x => x.playerName);
    return r.length ? { team: r[r.length - 1].winner, name: r[r.length - 1].playerName, key: (r[r.length - 1].winner || '?') + ':' + r[r.length - 1].playerName, members: [r[r.length - 1].playerName] } : null;
  };
  const laneKey = (s) => slotLane(s) || 'both';
  const group = {};   // lane|round -> [slots]
  for (const s of structured) {
    const k = laneKey(s) + '|' + s.roundNo;
    (group[k] = group[k] || []).push(s);
  }
  const laneRounds = (lane) => [...new Set(structured.filter(s => laneKey(s) === lane).map(s => s.roundNo))].sort((a, b) => a - b);
  return structured.map(s => {
    const lane = laneKey(s);
    const scored = resultsForSlot(results, s);
    let units = [], waiting = null, seeded = false;
    if (lane === 'final') {
      for (const tl of ['buffalo', 'roadhouse']) {
        const prior = laneRounds(tl).filter(r => r < s.roundNo);
        const srcs = prior.length ? (group[tl + '|' + prior[prior.length - 1]] || []) : [];
        const ws = srcs.map(winnerOf).filter(Boolean);
        if (ws.length) units.push(...ws);
        if (!srcs.length || ws.length < srcs.length) {
          waiting = waiting || `Waiting on the ${tl === 'buffalo' ? 'Buffalo' : 'Texas Roadhouse'} bracket winner`;
        }
      }
    } else {
      const prior = laneRounds(lane).filter(r => r < s.roundNo);
      if (!prior.length) {
        // Seed round — participants come from the slot's sign-ups.
        seeded = true;
        units = (lane === 'buffalo' || lane === 'roadhouse')
          ? slotUnits(s, lane).filter(u => !u.empty)
          : [...slotUnits(s, 'buffalo'), ...slotUnits(s, 'roadhouse')].filter(u => !u.empty);
      } else {
        const srcs = group[lane + '|' + prior[prior.length - 1]] || [];
        const siblings = group[lane + '|' + s.roundNo] || [s];
        const idx = Math.max(0, siblings.findIndex(x => x.id === s.id));
        const mine = srcs.slice(idx * 2, idx * 2 + 2);   // two feeder matches per match
        units = mine.map(winnerOf).filter(Boolean);
        const missing = (mine.length ? mine.filter(x => !winnerOf(x)).length : 0) + Math.max(0, 2 - Math.max(mine.length, units.length));
        if (units.length < 2) {
          waiting = missing > 0
            ? `Waiting on Round ${prior[prior.length - 1]} result${missing === 1 ? '' : 's'}`
            : null;
        }
      }
    }
    return { slot: s, lane, roundNo: s.roundNo, units, waiting, seeded, scored,
      roundLabel: lane === 'final' ? 'Championship' : `Round ${s.roundNo}` };
  }).concat(
    // Sign-up slots not yet placed in the bracket still need to be scoreable —
    // list them as seeds so nothing disappears when a bracket is half-built.
    (st.slots || []).filter(s => s.roundNo == null)
      .slice().sort((a, b) => (a.startMin - b.startMin) || (a.id - b.id))
      .map(s => {
        const lane = slotLane(s) || 'both';
        const units = (lane === 'buffalo' || lane === 'roadhouse')
          ? slotUnits(s, lane).filter(u => !u.empty)
          : [...slotUnits(s, 'buffalo'), ...slotUnits(s, 'roadhouse')].filter(u => !u.empty);
        return { slot: s, lane, roundNo: null, units, waiting: null, seeded: true,
          scored: resultsForSlot(results, s), roundLabel: null };
      })
  );
}

/* ════════════════════ auth screens ════════════════════ */
function inputStyle(pad) {
  return 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:' + (pad || '13px 14px') + ';color:#F3F7F5;font-size:14.5px;font-family:\'Montserrat\';outline:none;';
}
function fieldLabel(text, color) {
  return `<label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${color || '#FF7F2E'};margin-bottom:6px;">${text}</label>`;
}
function errLine(text) {
  return `<div style="font-size:12px;color:#FF7F2E;font-weight:600;">${esc(text)}</div>`;
}
function errLineIcon(text) {
  return `<div style="display:flex;align-items:center;gap:7px;font-size:12px;color:#FF7F2E;font-weight:600;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#FF7F2E" stroke-width="2"/><path d="M12 7v6M12 16.5v.5" stroke="#FF7F2E" stroke-width="2" stroke-linecap="round"/></svg>${esc(text)}</div>`;
}

function authScreen() {
  const f = S.f;
  const su = S.signupTeam;                          // tribe picked on sign-up
  const suIsBuf = (su || 'buffalo') === 'buffalo';
  const suIsRoad = su === 'roadhouse';
  const suAccent = suIsRoad ? '#E0322E' : '#FF5F00';
  const suAccentOn = suIsRoad ? '#fff' : '#011220';
  const suGlow = suIsRoad ? 'rgba(224,50,46,0.30)' : 'rgba(255,95,0,0.28)';
  const shirtOptions = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
  const yearOptions = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th or more'];

  let inner = '';
  if (S.authView === 'signin') {
    inner = `
      <div>
        <h2 style="font-family:'BN Kragen';font-size:40px;line-height:0.9;color:#F3F7F5;margin:6px 0 0;text-transform:uppercase;">Welcome<br/>back.</h2>
        <p style="font-size:13.5px;line-height:1.5;color:#C7D3DB;margin:12px 0 22px;max-width:290px;">Sign in to pick your events, check the day's run of play, and follow the score.</p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>${fieldLabel('Email')}
            <input id="in-email" data-field="inEmail" value="${esc(f.inEmail || '')}" placeholder="you@company.com" type="email" autocomplete="email" style="${inputStyle()}"/></div>
          <div>${fieldLabel('Password')}
            <input id="in-pass" data-field="inPass" value="${esc(f.inPass || '')}" placeholder="••••••••" type="password" autocomplete="current-password" style="${inputStyle()}"/></div>
          ${S.inErr ? errLine('Enter your email and password to continue.') : ''}
          ${S.authMsg ? errLine(S.authMsg) : ''}
          <button data-act="doSignIn" style="width:100%;background:#FF5F00;color:#011220;font-weight:800;font-size:15px;text-align:center;padding:15px;border-radius:9px;box-shadow:0 8px 22px rgba(255,95,0,0.28);margin-top:2px;">Sign in</button>
        </div>
        <button data-act="authView" data-view="signup" style="display:block;width:100%;text-align:center;margin-top:16px;font-size:13px;color:#C7D3DB;">New to Buff Olympics? <span style="color:#FF7F2E;font-weight:700;">Create an account</span></button>
        <div style="display:flex;align-items:center;gap:12px;margin:24px 0 16px;">
          <span style="flex:1;height:1px;background:rgba(255,255,255,0.12);"></span>
          <span style="font-size:10.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5C7B91;">Working the games?</span>
          <span style="flex:1;height:1px;background:rgba(255,255,255,0.12);"></span>
        </div>
        <button data-act="authView" data-view="ref" style="width:100%;display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.16);border-radius:9px;padding:14px 15px;text-align:left;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" stroke="#FF7F2E" stroke-width="2" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="#FF7F2E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:800;color:#F3F7F5;">Referees</div>
            <div style="font-size:11.5px;color:#8AA7B9;">Sign in or create a ref account</div>
          </div>
          ${chevR('#8AA7B9')}
        </button>
      </div>`;
  } else if (S.authView === 'signup') {
    const suBufBg = suIsBuf ? '#FF5F00' : 'rgba(255,255,255,0.05)';
    const suBufFg = suIsBuf ? '#011220' : '#C7D3DB';
    const suBufBorder = suIsBuf ? '#FF5F00' : 'rgba(255,255,255,0.14)';
    const suRoadBg = suIsRoad ? '#E0322E' : 'rgba(255,255,255,0.05)';
    const suRoadFg = suIsRoad ? '#fff' : '#C7D3DB';
    const suRoadBorder = suIsRoad ? '#E0322E' : 'rgba(255,255,255,0.14)';
    inner = `
      <div>
        <h2 style="font-family:'BN Kragen';font-size:38px;line-height:0.9;color:#F3F7F5;margin:6px 0 0;text-transform:uppercase;">Join the<br/>Herd.</h2>
        <p style="font-size:13px;line-height:1.5;color:#C7D3DB;margin:11px 0 20px;max-width:290px;">Pick your tribe, then tell us who you are.</p>
        <div style="display:flex;flex-direction:column;gap:13px;">
          <div>${fieldLabel('Your tribe', suAccent)}
            <div style="display:flex;gap:10px;">
              <button data-act="pickSignupTeam" data-team="buffalo" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;background:${suBufBg};border:1.5px solid ${suBufBorder};color:${suBufFg};border-radius:9px;padding:13px;font-size:13.5px;font-weight:800;transition:all .15s;">
                <img src="/assets/logos/buffalo-orange.png" alt="" style="height:18px;width:auto;"/>Buffalo
              </button>
              <button data-act="pickSignupTeam" data-team="roadhouse" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;background:${suRoadBg};border:1.5px solid ${suRoadBorder};color:${suRoadFg};border-radius:9px;padding:13px;font-size:13.5px;font-weight:800;transition:all .15s;">Texas Roadhouse</button>
            </div>
          </div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;">${fieldLabel('First name')}
              <input id="np-first" data-field="npFirst" value="${esc(f.npFirst || '')}" placeholder="Jordan" autocomplete="given-name" style="${inputStyle('12px 13px')}"/></div>
            <div style="flex:1;">${fieldLabel('Last name')}
              <input id="np-last" data-field="npLast" value="${esc(f.npLast || '')}" placeholder="Lee" autocomplete="family-name" style="${inputStyle('12px 13px')}"/></div>
          </div>
          <div>${fieldLabel('Email')}
            <input id="np-email" data-field="npEmail" value="${esc(f.npEmail || '')}" placeholder="you@company.com" type="email" autocomplete="email" style="${inputStyle('12px 13px')}"/></div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;">${fieldLabel('Password', suAccent)}
              <input id="np-pass" data-field="npPass" value="${esc(f.npPass || '')}" placeholder="Create a password" type="password" autocomplete="new-password" style="${inputStyle('12px 13px')}"/></div>
            <div style="flex:1;">${fieldLabel('Confirm password', suAccent)}
              <input id="np-pass2" data-field="npPass2" value="${esc(f.npPass2 || '')}" placeholder="Re-enter password" type="password" autocomplete="new-password" style="${inputStyle('12px 13px')}"/></div>
          </div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;">${fieldLabel('Shirt size', suAccent)}
              <select data-field="npShirt" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:12px 11px;color:#F3F7F5;font-size:14px;font-family:'Montserrat';outline:none;">
                ${shirtOptions.map(o => `<option value="${o}" style="color:#00253D;" ${o === (f.npShirt || 'M') ? 'selected' : ''}>${o}</option>`).join('')}
              </select></div>
            <div style="flex:1;">${fieldLabel('Which Buff Olympics is this for you?', suAccent)}
              <select data-field="npYears" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:12px 11px;color:#F3F7F5;font-size:14px;font-family:'Montserrat';outline:none;">
                ${yearOptions.map(o => `<option value="${o}" style="color:#00253D;" ${o === (f.npYears || '1st') ? 'selected' : ''}>${o}</option>`).join('')}
              </select></div>
          </div>
          <div>${fieldLabel('Song request for the DJ', suAccent)}
            <input id="np-song" data-field="npSong" value="${esc(f.npSong || '')}" placeholder="Artist — Song title" style="${inputStyle('12px 13px')}"/></div>
          ${S.inErr ? errLine('Please fill in your name, email and password.') : ''}
          ${S.pwErr ? errLineIcon("Passwords don't match — try again.") : ''}
          ${S.authMsg ? errLine(S.authMsg) : ''}
          <button data-act="doSignUp" style="width:100%;background:${suAccent};color:${suAccentOn};font-weight:800;font-size:15px;text-align:center;padding:15px;border-radius:9px;box-shadow:0 8px 22px ${suGlow};margin-top:2px;">Create my account</button>
        </div>
        <button data-act="authView" data-view="signin" style="display:block;width:100%;text-align:center;margin-top:15px;font-size:13px;color:#C7D3DB;">Already registered? <span style="color:#FF7F2E;font-weight:700;">Sign in</span></button>
      </div>`;
  } else {
    // referee auth
    const login = S.refMode === 'login';
    inner = `
      <div>
        <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,95,0,0.14);border:1px solid rgba(255,127,46,0.4);border-radius:20px;padding:6px 12px;margin-bottom:14px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" stroke="#FF7F2E" stroke-width="2" stroke-linejoin="round"/></svg>
          <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FF7F2E;">Referee access</span>
        </div>
        <h2 style="font-family:'BN Kragen';font-size:34px;line-height:0.9;color:#F3F7F5;margin:0;text-transform:uppercase;">SUP Refs.</h2>
        <p style="font-size:13px;line-height:1.5;color:#C7D3DB;margin:11px 0 18px;max-width:290px;">Log in, or create a ref account with the join code your event admin gave you.</p>
        <div style="display:flex;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:3px;gap:3px;margin-bottom:16px;">
          <button data-act="refMode" data-mode="login" style="flex:1;padding:9px;border-radius:6px;font-size:13px;font-weight:700;text-align:center;background:${login ? '#FF5F00' : 'transparent'};color:${login ? '#011220' : '#C7D3DB'};transition:all .15s;">Log in</button>
          <button data-act="refMode" data-mode="create" style="flex:1;padding:9px;border-radius:6px;font-size:13px;font-weight:700;text-align:center;background:${!login ? '#FF5F00' : 'transparent'};color:${!login ? '#011220' : '#C7D3DB'};transition:all .15s;">Create account</button>
        </div>
        ${login ? `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <input id="rl-user" data-field="rlUser" value="${esc(f.rlUser || '')}" placeholder="Username" autocomplete="username" style="${inputStyle()}"/>
          <input id="rl-pass" data-field="rlPass" value="${esc(f.rlPass || '')}" type="password" placeholder="Password" autocomplete="current-password" style="${inputStyle()}"/>
          ${S.inErr ? errLine('Enter your username and password.') : ''}
          ${S.authMsg ? errLine(S.authMsg) : ''}
          <button data-act="refLogin" style="width:100%;background:#FF5F00;color:#011220;font-weight:800;font-size:15px;text-align:center;padding:15px;border-radius:9px;box-shadow:0 8px 22px rgba(255,95,0,0.28);">Sign in as referee</button>
        </div>` : `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <input id="rc-user" data-field="rcUser" value="${esc(f.rcUser || '')}" placeholder="Choose a username" autocomplete="username" style="${inputStyle()}"/>
          <input id="rc-pass" data-field="rcPass" value="${esc(f.rcPass || '')}" type="password" placeholder="Create a password" autocomplete="new-password" style="${inputStyle()}"/>
          <div>${fieldLabel('Referee join code')}
            <input id="rc-code" data-field="rcCode" value="${esc(f.rcCode || '')}" placeholder="Enter the code from your admin" style="${inputStyle()}letter-spacing:0.04em;"/></div>
          ${S.rcErr ? errLineIcon("That join code isn't right. Check with your admin.") : ''}
          ${S.inErr ? errLine('Pick a username and password first.') : ''}
          ${S.authMsg ? errLine(S.authMsg) : ''}
          <button data-act="refCreate" style="width:100%;background:#FF5F00;color:#011220;font-weight:800;font-size:15px;text-align:center;padding:15px;border-radius:9px;box-shadow:0 8px 22px rgba(255,95,0,0.28);">Create referee account</button>
        </div>`}
        <button data-act="authView" data-view="signin" style="display:flex;align-items:center;gap:6px;margin-top:18px;font-size:13px;color:#8AA7B9;font-weight:600;">
          ${chevL('#8AA7B9')}
          Back to player sign-in
        </button>
      </div>`;
  }

  return `
  <div class="scrl" style="min-height:100vh;min-height:100dvh;background:#00141F;overflow-y:auto;overflow-x:hidden;position:relative;">
    <img src="/assets/logos/buffalo-white.png" alt="" style="position:absolute;right:-70px;top:30px;width:300px;opacity:0.05;pointer-events:none;"/>
    <div style="position:absolute;inset:0;background:radial-gradient(420px 300px at 50% 6%, rgba(255,95,0,0.16), transparent 70%);pointer-events:none;"></div>
    <div style="position:relative;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;padding:58px 24px 32px;max-width:440px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px;">
        <img src="/assets/logos/buffalo-orange.png" alt="" style="height:24px;width:auto;"/>
        <div style="line-height:1;">
          <div style="font-family:'BN Kragen';font-size:21px;color:#F3F7F5;letter-spacing:0.01em;">BUFF OLYMPICS</div>
          <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#FF7F2E;margin-top:4px;">August 14 · Buff Olympics</div>
        </div>
      </div>
      ${inner}
    </div>
  </div>`;
}

/* ════════════════════ team gate ════════════════════ */
function teamGateScreen() {
  return `
  <div style="min-height:100vh;min-height:100dvh;background:#00141F;display:flex;flex-direction:column;padding:64px 24px 30px;overflow:hidden;position:relative;">
    <img src="/assets/logos/buffalo-white.png" alt="" style="position:absolute;right:-60px;top:40px;width:300px;opacity:0.05;"/>
    <div style="position:absolute;inset:0;background:radial-gradient(420px 300px at 50% 8%, rgba(255,95,0,0.18), transparent 70%);"></div>
    <div style="position:relative;max-width:440px;margin:0 auto;width:100%;display:flex;flex-direction:column;flex:1;">
      <div style="position:relative;">
        <span style="font-size:11px;font-weight:600;color:#FF7F2E;letter-spacing:0.04em;">Buff Olympics · August 14</span>
        <h2 style="font-family:'BN Kragen';font-size:38px;line-height:0.9;color:#F3F7F5;margin:10px 0 0;text-transform:uppercase;">Pick your<br/>tribe.</h2>
        <p style="font-size:13.5px;line-height:1.5;color:#C7D3DB;margin:12px 0 0;max-width:300px;">Choose who you're riding with today. Your tribe themes the app and puts your roster front and center.</p>
      </div>
      <div style="position:relative;margin-top:auto;display:flex;flex-direction:column;gap:12px;padding-top:40px;">
        <button data-act="gateTeam" data-team="buffalo" style="width:100%;background:#FF5F00;border-radius:12px;padding:18px;display:flex;align-items:center;gap:15px;box-shadow:4px 4px 0 rgba(0,0,0,0.35);">
          <span style="width:50px;height:50px;border-radius:50%;border:2px solid #011220;display:flex;align-items:center;justify-content:center;font-family:'BN Kragen';font-size:20px;color:#011220;flex-shrink:0;">B</span>
          <div style="text-align:left;">
            <div style="font-family:'BN Kragen';font-size:24px;color:#011220;text-transform:uppercase;line-height:1;">Buffalo</div>
            <div style="font-size:12px;color:#3a1f0a;font-weight:600;margin-top:3px;">Herd strong · I'm a Teammate</div>
          </div>
        </button>
        <button data-act="gateTeam" data-team="roadhouse" style="width:100%;background:#F3F7F5;border-radius:12px;padding:18px;display:flex;align-items:center;gap:15px;box-shadow:4px 4px 0 rgba(0,0,0,0.35);">
          <span style="width:50px;height:50px;border-radius:50%;border:2px solid #00253D;display:flex;align-items:center;justify-content:center;font-family:'BN Kragen';font-size:18px;color:#00253D;flex-shrink:0;">TR</span>
          <div style="text-align:left;">
            <div style="font-family:'BN Kragen';font-size:24px;color:#00253D;text-transform:uppercase;line-height:1;">Texas Roadhouse</div>
            <div style="font-size:12px;color:#5C7B91;font-weight:600;margin-top:3px;">Ride or die · I'm a Roadie</div>
          </div>
        </button>
      </div>
    </div>
  </div>`;
}

/* ════════════════════ home (Tribal Council) ════════════════════ */
function homeAgenda(T) {
  const sched = S.boot.schedule || [];
  const items = [];
  const live = sched.find(e => e.kind === 'live');
  if (live) items.push({ time: live.timeLabel + ' ' + live.ampm, name: live.title, state: 'now' });
  const mine = (S.boot.mySignups || []).map(m => ({ min: m.startMin, time: m.label, name: m.game }));
  // Dip Off cooks drop their dip at the Cafe at 11:30 — put it on their slate.
  if (S.boot.dip && S.boot.dip.myEntry) mine.push({ min: 690, time: '11:30 AM', name: 'Drop off your dip · The Cafe' });
  mine.sort((a, b) => a.min - b.min);
  for (const m of mine) {
    items.push({ time: m.time, name: m.name, state: 'up' });
  }
  const next = sched.find(e => e.kind === 'up');
  if (next) items.push({ time: next.timeLabel + ' ' + next.ampm, name: next.title, state: 'up' });
  return items.slice(0, 5).map(e => ({
    ...e,
    now: e.state === 'now',
    dot: e.state === 'now' ? T.A : (e.state === 'done' ? '#5C7B91' : 'transparent'),
    dotBorder: e.state === 'now' ? T.A : '#5C7B91',
    nameColor: e.state === 'done' ? '#8AA7B9' : T.th.text,
  }));
}
function aroundCamp(T) {
  const anns = S.boot.announcements || [];
  if (anns.length) {
    return anns.slice(0, 6).map((a, i) => ({
      text: a.title,
      meta: (a.body ? String(a.body).slice(0, 90) + (String(a.body).length > 90 ? '…' : '') + ' · ' : '') + timeAgo(a.createdAt),
      color: i % 2 === 0 ? T.A : T.th.text,
    }));
  }
  const sched = S.boot.schedule || [];
  const out = [];
  const live = sched.find(e => e.kind === 'live');
  if (live) out.push({ text: live.title + ' is underway', meta: live.place + ' · now', color: T.A });
  sched.filter(e => e.kind === 'up').slice(0, 2).forEach(e =>
    out.push({ text: e.title, meta: e.place + ' · ' + e.timeLabel + ' ' + e.ampm, color: T.th.text }));
  sched.filter(e => e.kind === 'done').slice(-1).forEach(e =>
    out.push({ text: e.title + ' wrapped', meta: e.place, color: T.th.text }));
  return out;
}
function homeScreen() {
  const T = theme();
  const th = T.th;
  const boot = S.boot;
  const isGameDay = boot.settings.eventMode === 'gameday';
  const signupCount = (boot.mySignups || []).length;
  const allPicked = signupCount >= signupMax();
  const myTeam = boot.user.team || 'buffalo';
  const myDipCount = (boot.dip && boot.dip.counts && boot.dip.counts[myTeam]) || 0;
  const dipCount = (boot.dip && boot.dip.entries || []).length;
  const iCook = !!(boot.dip && boot.dip.myEntry);
  const dipFull = !iCook && myDipCount >= 5;                  // my tribe's cook spots are gone
  const relay = boot.relay || { legs: [], myLeg: null };
  const myLegObj = (relay.legs || []).find(l => l.id === relay.myLeg) || null;
  const scores = boot.scores || { revealed: false };
  const agenda = homeAgenda(T);
  const feed = aroundCamp(T);
  // Walk-up games open for free scoring after their sign-up window closes.
  const walkups = (boot.games || []).filter(g => g.openPlay).map(g => {
    const slots = (g.slots || []).slice().sort((a, b) => a.startMin - b.startMin);
    const last = slots[slots.length - 1];
    return { name: g.name, venue: g.venue || '', openLabel: last ? `Open for walk-up after ${last.label}` : 'Open all day' };
  });

  const scoresCard = scores.revealed ? `
      <button data-act="go" data-to="score" style="width:100%;background:${th.panel};border:1px solid ${T.A};border-radius:10px;padding:15px;display:flex;align-items:center;gap:13px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M7 4h10v3a5 5 0 01-10 0V4z" stroke="${T.A}" stroke-width="2" stroke-linejoin="round"/><path d="M5 5H3v2a3 3 0 003 3M19 5h2v2a3 3 0 01-3 3M9 20h6M12 13v7" stroke="${T.A}" stroke-width="2" stroke-linecap="round"/></svg>
        <div style="flex:1;text-align:left;">
          <div style="font-size:13.5px;font-weight:700;color:${th.text};">Buffalo ${scores.buffalo} · ${scores.roadhouse} Texas Roadhouse</div>
          <div style="font-size:11.5px;color:${th.sub};margin-top:2px;">Final standings are live — tap for the Score Room</div>
        </div>
        ${chevR(T.A)}
      </button>` : `
      <button data-act="go" data-to="score" style="width:100%;background:${th.panel};border:1px solid ${th.panelBorder};border-radius:10px;padding:15px;display:flex;align-items:center;gap:13px;">
        ${lockSvg(T.A)}
        <div style="flex:1;text-align:left;">
          <div style="font-size:13.5px;font-weight:700;color:${th.text};">Team scores are sealed</div>
          <div style="font-size:11.5px;color:${th.sub};margin-top:2px;">See your own results · full board at the 4:00 PM reveal</div>
        </div>
        ${chevR(T.A)}
      </button>`;

  return `
  <div>
    <div style="display:flex;align-items:center;gap:10px;padding:11px 18px;background:${T.dim};border-bottom:1px solid rgba(255,255,255,0.07);">
      ${T.isRoad
        ? '<img src="/assets/logos/texas-roadhouse.png" alt="" style="height:26px;width:auto;"/>'
        : '<img src="/assets/logos/buffalo-orange.png" alt="" style="height:18px;width:auto;"/>'}
      <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A};">${T.myTeamWord}</span>
    </div>
    <div style="position:relative;padding:26px 20px 26px;background:${th.hero};overflow:hidden;min-height:330px;">
      ${T.isRoad
        ? '<img src="/assets/logos/texas-roadhouse.png" alt="" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:380px;opacity:0.08;"/>'
        : '<img src="/assets/logos/buffalo-white.png" alt="" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:380px;opacity:0.06;"/>'}
      <div style="position:absolute;inset:0;background:radial-gradient(420px 280px at 50% 12%, ${T.glow}, transparent 70%);"></div>
      <div style="position:relative;">
        <span style="font-size:11px;font-weight:600;color:${T.A};letter-spacing:0.04em;">Welcome back, ${esc(boot.user.firstName || T.myTeamWord)}</span>
        <h2 style="font-family:'BN Kragen';font-size:52px;line-height:0.86;color:${th.text};margin:14px 0 0;text-transform:uppercase;">Buff<br/>Olympics.</h2>
        <p style="font-size:14px;line-height:1.5;color:#C7D3DB;max-width:280px;margin:16px 0 22px;">One day. Two tribes. A field full of games. The fire's lit — let's find out who walks through the storm.</p>
        <button data-act="go" data-to="immunity" style="display:inline-flex;align-items:center;gap:10px;background:${T.A};color:${T.on};font-weight:700;font-size:14px;padding:13px 20px;border-radius:8px;box-shadow:0 0 28px ${T.glow};">
          Hunt the hidden idols
          ${chevR(T.on, 9, 15, 2.4)}
        </button>
        <div style="margin-top:16px;">
          <button data-act="changeTribe" style="font-size:11.5px;font-weight:700;color:${th.sub};">Your tribe: <span style="color:${T.A};">${T.myTeamName}</span> · change</button>
        </div>
      </div>
    </div>

    ${isGameDay ? `
    <div style="padding:16px 18px 0;">
      <div style="display:flex;align-items:center;gap:9px;background:${T.dim};border:1px solid ${T.A};border-radius:10px;padding:11px 14px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${T.A};box-shadow:0 0 8px ${T.A};flex-shrink:0;"></span>
        <span style="font-size:12px;font-weight:700;color:${th.text};">Game Day is live — sign-ups are locked. Time to compete &amp; vote.</span>
      </div>
    </div>
    <div style="padding:18px 18px 0;">
      <button data-act="go" data-to="dip-vote" style="width:100%;background:${T.A};color:${T.on};border-radius:11px;padding:16px;display:flex;align-items:center;gap:13px;box-shadow:0 8px 22px ${T.glow};">
        ${dipSvg(T.on)}
        <div style="flex:1;text-align:left;">
          <div style="font-size:15px;font-weight:800;">Vote for your favorite dip</div>
          <div style="font-size:11.5px;opacity:0.82;">${dipCount} dips in the running · one vote each</div>
        </div>
        ${chevR(T.on, 9, 15, 2.4)}
      </button>
    </div>
    <div style="padding:14px 18px 0;">
      <div style="background:${th.panel};border:1px solid ${th.panelBorder};border-radius:11px;overflow:hidden;">
        <button data-act="toggleWalkup" style="width:100%;text-align:left;display:flex;align-items:center;gap:13px;padding:15px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M7 4h10v3a5 5 0 01-10 0V4z" stroke="${T.A}" stroke-width="2" stroke-linejoin="round"/><path d="M5 5H3v2a3 3 0 003 3M19 5h2v2a3 3 0 01-3 3M9 20h6M12 13v7" stroke="${T.A}" stroke-width="2" stroke-linecap="round"/></svg>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14.5px;font-weight:800;color:${th.text};">Want to earn more points for your team?</div>
            <div style="font-size:11.5px;color:${th.sub};margin-top:2px;">${walkups.length} walk-up game${walkups.length === 1 ? '' : 's'} you can jump into — tap to see when</div>
          </div>
          <span style="flex-shrink:0;transition:transform .15s;transform:rotate(${S.walkupOpen ? '90deg' : '0deg'});">${chevR(T.A)}</span>
        </button>
        ${S.walkupOpen ? `
        <div style="padding:0 15px 8px;">
          ${walkups.length ? walkups.map(w => `
          <div style="display:flex;align-items:flex-start;gap:11px;padding:11px 0;border-top:1px solid rgba(255,255,255,0.07);">
            <span style="width:8px;height:8px;border-radius:50%;background:${T.A};margin-top:5px;flex-shrink:0;"></span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13.5px;font-weight:700;color:${th.text};">${esc(w.name)}</div>
              <div style="font-size:11.5px;color:${T.A};font-weight:600;margin-top:2px;">${esc(w.openLabel)}${w.venue ? ` · ${esc(w.venue)}` : ''}</div>
            </div>
          </div>`).join('') : `<div style="padding:12px 0 14px;border-top:1px solid rgba(255,255,255,0.07);font-size:12.5px;color:${th.sub};">No walk-up games right now.</div>`}
        </div>` : ''}
      </div>
    </div>` : `
    <div style="padding:18px 18px 0;">
      ${allPicked ? `
      <button data-act="go" data-to="games" style="width:100%;background:${th.panel};border:1px solid #3FBF87;border-radius:11px;padding:16px;display:flex;align-items:center;gap:13px;">
        ${checkSvg('#3FBF87', 24, 2.6)}
        <div style="flex:1;text-align:left;">
          <div style="font-size:15px;font-weight:800;color:${th.text};">You're all signed up!</div>
          <div style="font-size:11.5px;color:${th.sub};margin-top:2px;">All ${signupMax()} of your game slots are claimed · tap to review</div>
        </div>
        ${chevR('#3FBF87', 9, 15, 2.4)}
      </button>` : `
      <button data-act="go" data-to="games" style="width:100%;background:${T.A};color:${T.on};border-radius:11px;padding:16px;display:flex;align-items:center;gap:13px;box-shadow:0 8px 22px ${T.glow};">
        ${clipSvg(T.on)}
        <div style="flex:1;text-align:left;">
          <div style="font-size:15px;font-weight:800;">Sign up for games</div>
          <div style="font-size:11.5px;opacity:0.82;">${signupCount} of ${signupMax()} picked · pick your events</div>
        </div>
        ${chevR(T.on, 9, 15, 2.4)}
      </button>`}
      <div style="display:flex;gap:11px;margin-top:11px;">
        <button data-act="go" data-to="dip" style="flex:1;background:${th.panel};border:1px solid ${iCook ? '#3FBF87' : th.panelBorder};border-radius:11px;padding:15px 13px;text-align:left;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 11h16M5 11a7 7 0 0014 0M12 3v2M9 5.5C9 6 9.5 6.5 9.5 7M15 5.5C15 6 14.5 6.5 14.5 7M8 20h8" stroke="${T.A}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div style="font-size:13.5px;font-weight:800;color:${th.text};margin-top:9px;">Dip Off</div>
          <div style="font-size:11px;color:${iCook ? '#3FBF87' : th.sub};margin-top:2px;font-weight:${iCook || dipFull ? '700' : '400'};">${iCook ? "You're cooking ✓ · drop off 11:30 AM" : (dipFull ? "Your tribe's 5 spots are full" : `${myDipCount} of 5 cooks · sign up`)}</div>
        </button>
        <button data-act="go" data-to="relay" style="flex:1;background:${th.panel};border:1px solid ${myLegObj ? '#3FBF87' : th.panelBorder};border-radius:11px;padding:15px 13px;text-align:left;">
          ${relaySvg(T.A)}
          <div style="font-size:13.5px;font-weight:800;color:${th.text};margin-top:9px;">Relay Race</div>
          <div style="font-size:11px;color:${myLegObj ? '#3FBF87' : '#F5C518'};margin-top:2px;font-weight:700;">${myLegObj ? `You're in ✓ · ${esc(myLegObj.name)}` : 'No leg picked yet — grab one!'}</div>
        </button>
      </div>
    </div>`}

    <div style="padding:20px 18px 0;">${scoresCard}</div>

    <div style="padding:14px 18px 0;">
      <div style="background:${th.panel};border:1px solid ${th.panelBorder};border-radius:10px;overflow:hidden;">
        <button data-act="go" data-to="schedule" style="width:100%;text-align:left;display:flex;align-items:center;justify-content:space-between;padding:14px 16px 11px;">
          <span style="display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${T.A};">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="16" rx="2" stroke="${T.A}" stroke-width="2"/><path d="M4 9h16M8 3v4M16 3v4" stroke="${T.A}" stroke-width="2" stroke-linecap="round"/></svg>
            My Schedule
          </span>
          <span style="font-size:11.5px;font-weight:700;color:${th.sub};">Full day →</span>
        </button>
        <div style="padding:0 16px 6px;">
          ${agenda.length ? agenda.map(e => `
          <div style="display:flex;align-items:center;gap:13px;padding:10px 0;border-top:1px solid rgba(255,255,255,0.07);">
            <span style="width:11px;height:11px;border-radius:50%;background:${e.dot};border:2px solid ${e.dotBorder};flex-shrink:0;"></span>
            <span style="width:64px;flex-shrink:0;font-size:11.5px;font-weight:700;color:${th.sub};">${esc(e.time)}</span>
            <span style="flex:1;font-size:13.5px;font-weight:600;color:${e.nameColor};">${esc(e.name)}</span>
            ${e.now ? `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;color:${T.on};background:${T.A};border-radius:4px;padding:2px 6px;flex-shrink:0;">NOW</span>` : ''}
          </div>`).join('') : `
          <div style="padding:12px 0 14px;border-top:1px solid rgba(255,255,255,0.07);font-size:12.5px;color:${th.sub};">Nothing on your slate yet — sign up for a game to build your day.</div>`}
        </div>
      </div>
    </div>

    <div style="padding:22px 18px 10px;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${th.sub};">Around camp</span>
      <div style="margin-top:13px;display:flex;flex-direction:column;">
        ${feed.map(fd => `
        <div style="display:flex;gap:13px;padding-bottom:16px;position:relative;">
          <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
            <span style="width:11px;height:11px;border-radius:50%;background:${fd.color};margin-top:3px;"></span>
            <span style="flex:1;width:2px;background:rgba(255,255,255,0.10);margin-top:3px;"></span>
          </div>
          <div style="flex:1;">
            <div style="font-size:13.5px;color:${th.text};line-height:1.4;">${esc(fd.text)}</div>
            <div style="font-size:11px;color:${th.sub};margin-top:2px;">${esc(fd.meta)}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>

    ${S.isDesk ? '' : `
    <div style="padding:0 18px 26px;">
      <button data-act="signOut" style="font-size:12px;font-weight:700;color:${th.sub};text-decoration:underline;">Sign out</button>
    </div>`}
  </div>`;
}

/* ════════════════════ ref board (home + score for refs) ════════════════════ */
function refBoardScreen() {
  const T = theme();
  const th = T.th;
  const stations = S.boot.refStations || [];
  const q2 = (S.walkSearch || '').trim().toLowerCase();
  const allPlayers = S.boot.allPlayers || [];

  const stationHtml = stations.map(st => {
    const open = S.refOpen === st.gameId;
    const isVs = st.type === 'vs', isWalk = st.type === 'walk';
    const typeLabel = isVs ? 'Head-to-head' : 'Score per player';
    const green = '#3FBF87';
    // Everything already logged for this game — powers the "Scored" marks,
    // the logged-result panels, the bracket engine, and the all-scored state.
    const results = (S.boot.refResults || []).filter(r => r.game === st.name);
    // A fixed-time game whose every slot has at least one logged result is DONE
    // — the whole box goes green so refs can see what's left at a glance.
    const allSlots = st.slots || [];
    const allScored = !st.openPlay && allSlots.length > 0 && allSlots.every(s => resultsForSlot(results, s).length > 0);
    // "Open all day" tracks walk-up scheduling (open_play), independent of scoring style.
    const statusLabel = allScored ? 'All slots scored' : (st.openPlay ? 'Open all day' : 'On station');
    const statusColor = (allScored || st.openPlay) ? green : T.A;
    const rowBg = allScored && !open ? 'rgba(63,191,135,0.10)' : (open ? th.panel : T.dim);
    const rowBorder = allScored ? green : T.A;

    let body = '';
    if (open) {
      const slots = (st.slots || []).slice().sort((a, b) => a.startMin - b.startMin);
      const selId = S.refSlot[st.gameId];
      const selSlot = slots.find(s => String(s.id) === String(selId)) || null;
      const isBracket = st.isBracket !== undefined ? st.isBracket : !!BRACKETS[st.gameId];
      const brData = (st.bracket && (st.bracket.rounds || []).length) ? st.bracket : (BRACKETS[st.gameId] || null);
      const winPts = st.winPoints != null ? st.winPoints : 10;
      const roundPts = st.roundPoints != null ? st.roundPoints : 0;
      const teamColor = (t) => t === 'buffalo' ? '#FF5F00' : '#E0322E';
      const teamLabel = (t) => t === 'buffalo' ? 'Buffalo' : 'Texas Roadhouse';

      // One logged result + its "Change" button (warns before removing).
      const resultRow = (r) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(63,191,135,0.25);">
          <span style="flex-shrink:0;">${checkSvg(green, 14, 2.6)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12.5px;font-weight:700;color:${th.text};">${esc(r.detail || r.playerName || '')}</div>
            <div style="font-size:10.5px;color:${th.sub};margin-top:1px;">by ${esc(r.enteredBy || '—')} · ${timeAgo(r.createdAt)}</div>
          </div>
          <span style="flex-shrink:0;font-family:'BN Kragen';font-size:15px;color:${green};">${r.pts > 0 ? '+' + r.pts : '—'}</span>
          <button data-act="refChangeResult" data-ids="${r.id}" style="flex-shrink:0;font-size:11px;font-weight:800;color:#F5C518;border:1px solid rgba(245,197,24,0.5);border-radius:7px;padding:6px 10px;">Change</button>
        </div>`;
      const scoredPanel = (rows) => `
        <div style="margin-top:14px;background:rgba(63,191,135,0.08);border:1px solid rgba(63,191,135,0.45);border-radius:10px;padding:4px 13px 10px;">
          <div style="padding:10px 0 2px;font-size:10.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${green};">✓ Scored</div>
          ${rows.map(resultRow).join('')}
          <div style="font-size:10.5px;color:${th.sub};margin-top:8px;line-height:1.45;">Need to fix it? Tap Change — the logged entry is removed so you can re-enter it.</div>
        </div>`;

      // ── structured bracket? (migration 012) each slot is a MATCH with real
      //    progression: seeds from sign-ups, later rounds fed by winners ──
      const matches = (isVs && isBracket) ? bracketMatches(st, results) : null;
      const matchById = {};
      if (matches) for (const m of matches) matchById[m.slot.id] = m;

      const matchRow = (m) => {
        const s = m.slot;
        const on = String(s.id) === String(selId);
        const scored = m.scored.length > 0;
        const laneBadge = m.lane === 'final'
          ? `<span style="font-size:9px;font-weight:800;color:#F5C518;border:1px solid rgba(245,197,24,0.5);border-radius:4px;padding:1px 6px;">🏆 FINAL</span>`
          : (m.lane === 'buffalo' || m.lane === 'roadhouse')
            ? `<span style="font-size:9px;font-weight:800;text-transform:uppercase;color:${teamColor(m.lane)};border:1px solid ${teamColor(m.lane)};border-radius:4px;padding:1px 6px;">${m.lane === 'buffalo' ? 'BUFFALO' : 'TXRH'}</span>`
            : '';
        let line;
        if (scored) line = `Winner: ${esc((m.scored[m.scored.length - 1].playerName || ''))}`;
        else if (m.units.length >= 2) line = m.units.map(u => esc(u.name)).join('  vs  ');
        else if (m.units.length === 1) line = `${esc(m.units[0].name)}  vs  ${m.waiting ? '⏳ ' + esc(m.waiting) : '—'}`;
        else if (m.waiting) line = `⏳ ${esc(m.waiting)}`;
        else line = m.seeded ? 'No sign-ups yet' : '⏳ Waiting on the previous round';
        return `<button data-act="refSelectSlot" data-game="${esc(st.gameId)}" data-slot="${s.id}" style="text-align:left;border-radius:9px;padding:11px 12px;border:1px solid ${on ? T.A : (scored ? 'rgba(63,191,135,0.5)' : th.line)};background:${on ? T.dim : 'rgba(255,255,255,0.03)'};">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-family:'BN Kragen';font-size:15px;color:${on ? T.A : th.text};">${esc(s.label)}</span>${laneBadge}${scored ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;color:${green};border:1px solid ${green};border-radius:4px;padding:1px 6px;">${checkSvg(green, 9, 3)}SCORED</span>` : ''}${on ? `<span style="font-size:9px;font-weight:800;color:${T.on};background:${T.A};border-radius:4px;padding:1px 6px;">SCORING</span>` : ''}</div>
          <div style="font-size:11px;color:${m.waiting && !scored && m.units.length < 2 ? T.A2 : th.sub};margin-top:3px;">${line}</div>
        </button>`;
      };

      // ── timeslot picker — the ref chooses which slot they're scoring (games
      //    can be played out of order) and sees the players in each ──
      let slotPicker;
      if (matches) {
        // Group matches by round; the championship renders last.
        const groups = [];
        for (const m of matches) {
          const label = m.roundNo == null ? 'Sign-up slots' : (m.lane === 'final' ? `Round ${m.roundNo} · Championship` : `Round ${m.roundNo}`);
          let grp = groups.find(x => x.label === label);
          if (!grp) { grp = { label, rows: [] }; groups.push(grp); }
          grp.rows.push(matchRow(m));
        }
        slotPicker = `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin-bottom:9px;">Bracket — pick the match you're scoring</div>` +
          groups.map(gp => `<div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${th.sub};margin:10px 0 6px;">${esc(gp.label)}</div><div style="display:flex;flex-direction:column;gap:7px;">${gp.rows.join('')}</div>`).join('');
      } else {
        slotPicker = slots.length ? `
        <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin-bottom:9px;">Which timeslot are you scoring?</div>
        <div style="display:flex;flex-direction:column;gap:7px;">
          ${slots.map(s => {
            const on = String(s.id) === String(selId);
            const buf = s.buffalo || [], road = s.roadhouse || [];
            const n = buf.length + road.length;
            const scored = resultsForSlot(results, s).length > 0;
            const summ = n ? [buf.length ? `Buffalo: ${esc(buf.join(', '))}` : '', road.length ? `TXRH: ${esc(road.join(', '))}` : ''].filter(Boolean).join('  ·  ') : 'No players signed up';
            return `<button data-act="refSelectSlot" data-game="${esc(st.gameId)}" data-slot="${s.id}" style="text-align:left;border-radius:9px;padding:11px 12px;border:1px solid ${on ? T.A : (scored ? 'rgba(63,191,135,0.5)' : th.line)};background:${on ? T.dim : 'rgba(255,255,255,0.03)'};">
              <div style="display:flex;align-items:center;gap:8px;"><span style="font-family:'BN Kragen';font-size:15px;color:${on ? T.A : th.text};">${esc(s.label)}</span>${scored ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:800;color:${green};border:1px solid ${green};border-radius:4px;padding:1px 6px;">${checkSvg(green, 9, 3)}SCORED</span>` : ''}${on ? `<span style="font-size:9px;font-weight:800;color:${T.on};background:${T.A};border-radius:4px;padding:1px 6px;">SCORING</span>` : ''}</div>
              <div style="font-size:11px;color:${th.sub};margin-top:3px;">${summ}</div>
            </button>`;
          }).join('')}
        </div>` : '';
      }

      // ── walk-on add (walk-up games): score anyone not on the slot list ──
      const walkOnBlock = () => {
        const matches = q2 ? allPlayers.filter(p => p.name.toLowerCase().includes(q2)).slice(0, 4) : [];
        return `
        <div style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A};margin:2px 0 10px;">Walk-on · anyone not on the list</div>
        <div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);border:1px solid ${th.line};border-radius:9px;padding:11px 13px;">
          ${searchSvg(th.sub)}
          <input id="walk-input" data-live="walkSearch" value="${esc(S.walkSearch)}" placeholder="Search player name…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${th.text};font-size:14px;font-family:'Montserrat';"/>
        </div>
        ${matches.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">${matches.map((m, i) => `<button data-act="walkPick" data-i="${i}" data-name="${esc(m.name)}" data-team="${esc(m.team)}" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:8px;padding:10px 12px;"><span style="font-size:13.5px;font-weight:700;color:${th.text};">${esc(m.name)}</span><span style="font-size:10.5px;font-weight:700;text-transform:uppercase;color:${th.sub};">${teamLabel(m.team)}</span></button>`).join('')}</div>` : ''}
        ${S.walkPick ? `<div style="margin-top:11px;display:flex;align-items:center;gap:12px;background:${th.dim};border:1px solid ${th.line};border-radius:9px;padding:12px 13px;"><span style="flex:1;font-size:13.5px;font-weight:700;color:${th.text};">${esc(S.walkPick.name)}</span><div style="flex-shrink:0;"><input id="walk-score-in" data-walkscore value="${S.walkScore || ''}" inputmode="numeric" pattern="[0-9]*" placeholder="0" style="width:72px;text-align:center;background:rgba(255,255,255,0.06);border:1px solid ${th.line};border-radius:8px;padding:9px 8px;color:${th.text};font-family:'BN Kragen';font-size:18px;outline:none;"/></div></div><button data-act="walkSubmit" data-game="${esc(st.gameId)}" style="width:100%;margin-top:11px;background:${T.A};color:${T.on};font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">Add ${esc(S.walkPick.name)}'s score</button>` : ''}`;
      };

      // ── scoring panel, scoped to the selected slot ──
      const slotResults = selSlot ? resultsForSlot(results, selSlot) : [];
      let scorer;
      if (!slots.length && isWalk) {
        scorer = walkOnBlock();                          // pure walk-up, no slots
      } else if (!selSlot && slots.length) {
        scorer = `<div style="margin-top:14px;font-size:12.5px;color:${th.sub};font-style:italic;">${matches ? 'Pick a match above to score it.' : 'Pick a timeslot above to score it.'}</div>`;
      } else if (matches && selSlot && matchById[selSlot.id]) {
        // ── structured bracket match ──
        const m = matchById[selSlot.id];
        const isFinal = m.lane === 'final';
        const pts = isFinal ? winPts : roundPts;
        const sel = S.refWinner;
        const unitBtnB = (u) => {
          const picked = sel && sel.key === u.key;
          const c = teamColor(u.team);
          return `<button data-act="refPickWinner" data-team="${u.team}" data-name="${esc(u.name)}" data-key="${esc(u.key)}" data-scores="${isFinal ? '1' : '0'}" style="flex:1;min-width:132px;text-align:left;border-radius:10px;padding:12px;border:2px solid ${picked ? c : th.line};background:${picked ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'};"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:${c};">${teamLabel(u.team)}${u.label && u.label !== u.name ? ' · ' + esc(u.label) : ''}</div><div style="font-size:13px;font-weight:700;color:${th.text};margin-top:4px;line-height:1.25;">${esc(u.name)}</div>${picked ? `<div style="margin-top:6px;font-size:10.5px;font-weight:800;color:${c};display:flex;align-items:center;gap:5px;">${checkSvg(c, 12)}Winner</div>` : ''}</button>`;
        };
        scorer = `<div style="height:1px;background:${th.line};margin:16px 0 14px;"></div>`;
        if (m.scored.length) {
          scorer += scoredPanel(m.scored);
        } else if (m.waiting && m.units.length < 2) {
          scorer += `<div style="display:flex;gap:9px;align-items:flex-start;background:rgba(255,255,255,0.04);border:1px dashed ${th.line};border-radius:10px;padding:13px 14px;"><span>⏳</span><div><div style="font-size:13px;font-weight:700;color:${th.text};">${esc(m.waiting)}</div><div style="font-size:11.5px;color:${th.sub};margin-top:3px;">This match fills in automatically once the earlier round is scored.</div></div></div>`;
          if (m.units.length === 1) scorer += `<div style="margin-top:9px;font-size:11.5px;color:${th.sub};">Already in: <strong style="color:${th.text};">${esc(m.units[0].name)}</strong></div>`;
        } else if (!m.units.length) {
          scorer += `<div style="margin-top:2px;font-size:12.5px;color:${th.sub};font-style:italic;">No one signed up for this match yet.</div>`;
        } else {
          scorer += `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin-bottom:9px;">${esc(m.roundLabel || selSlot.label)} · tap the winner${pts > 0 ? ` — earns ${pts} pts` : ''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:9px;">${m.units.map(unitBtnB).join('')}</div>
            <button data-act="refBracketSubmit" data-game="${esc(st.gameId)}" data-slot="${selSlot.id}" data-stage="${isFinal ? 'champ' : 'round'}" data-roundlabel="${esc(m.roundLabel || '')}" style="width:100%;margin-top:14px;background:${sel ? T.A : 'rgba(255,255,255,0.08)'};color:${sel ? T.on : th.sub};font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">${!sel ? 'Tap the winner first' : (isFinal ? `Log ${esc(sel.name)} — Champion · +${winPts} pts` : (roundPts > 0 ? `Log ${esc(sel.name)} — advances · +${roundPts} pts` : `Log ${esc(sel.name)} — advances`))}</button>`;
        }
      } else if (isWalk) {
        // Not head-to-head → variable score, one number PER PERSON. Two people in
        // a slot are scored separately (each is its own logged result). Already-
        // scored people drop off the list until their result is Changed.
        const people = [
          ...((selSlot.buffalo || []).map(n => ({ name: n, team: 'buffalo' }))),
          ...((selSlot.roadhouse || []).map(n => ({ name: n, team: 'roadhouse' }))),
        ];
        const scoredNames = new Set(slotResults.map(r => (r.playerName || '').trim()).filter(Boolean));
        const todo = people.filter(p => !scoredNames.has(p.name));
        const personRow = (p, i) => {
          const c = teamColor(p.team);
          return `<div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.03);border:1px solid ${th.line};border-radius:9px;padding:11px 13px;">
            <div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:700;color:${th.text};">${esc(p.name)}</div><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:${c};margin-top:2px;">${teamLabel(p.team)}</div></div>
            <input id="solo-${i}" data-soloscore="${esc(p.name)}" data-team="${esc(p.team)}" value="${S.soloScores[p.name] || ''}" inputmode="numeric" pattern="[0-9]*" placeholder="0" style="width:74px;text-align:center;background:rgba(255,255,255,0.06);border:1px solid ${th.line};border-radius:8px;padding:9px 8px;color:${th.text};font-family:'BN Kragen';font-size:18px;outline:none;"/>
          </div>`;
        };
        scorer = `<div style="height:1px;background:${th.line};margin:16px 0 14px;"></div>`;
        if (slotResults.length) scorer += scoredPanel(slotResults);
        if (todo.length) {
          scorer += `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A};margin:14px 0 10px;">${esc(selSlot.label)} · score each player</div><div style="display:flex;flex-direction:column;gap:8px;">${todo.map(personRow).join('')}</div><button data-act="refSoloSubmit" data-game="${esc(st.gameId)}" style="width:100%;margin-top:13px;background:${T.A};color:${T.on};font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">Save scores</button>`;
        } else if (people.length) {
          scorer += `<div style="margin-top:12px;font-size:12px;color:${th.sub};font-style:italic;">Everyone here is scored — tap Change on a row to fix one.</div>`;
        } else {
          scorer += `<div style="margin-top:12px;font-size:12px;color:${th.sub};font-style:italic;">No players signed up for this slot.</div>`;
        }
        // The "score anyone not on the list" walk-on search is only for true
        // walk-up (open_play) games — a fixed-roster game scores its slot only.
        // Team walk-ups use the matchup builder (below) instead: one name would
        // just be duplicated across the team spots.
        if (st.openPlay && (st.teamSize || 1) < 2) scorer += `<div style="height:1px;background:${th.line};margin:16px 0 14px;"></div>${walkOnBlock()}`;
      } else {
        // Head-to-head — the ref taps the WINNING UNIT (a whole team for team
        // games, a single player otherwise) and can log several matchups in the
        // same slot (each tap logs its own result). Bracket rounds are within
        // each tribe; the championship is cross-tribe.
        const round = isBracket ? (S.refRound || 'round') : 'champ';
        const sel = S.refWinner;
        const isTeamGame = (st.teamSize || 1) >= 2;
        const roundNames = brData ? brData.rounds.filter(r => r.team !== 'final').map(r => r.name) : [];
        const champName = brData ? (((brData.rounds || []).find(r => r.team === 'final') || {}).name || 'Championship') : 'Championship';
        const selRound = roundNames.includes(S.refRoundSel) ? S.refRoundSel : (roundNames[0] || 'Bracket round');
        const bufUnits = selSlot ? slotUnits(selSlot, 'buffalo').filter(u => !u.empty) : [];
        const roadUnits = selSlot ? slotUnits(selSlot, 'roadhouse').filter(u => !u.empty) : [];
        const unitBtn = (u, scores) => {
          const picked = sel && sel.key === u.key && sel.scores === scores;
          const c = teamColor(u.team);
          const sub = isTeamGame ? `${teamLabel(u.team)} · ${esc(u.label)}` : teamLabel(u.team);
          return `<button data-act="refPickWinner" data-team="${u.team}" data-name="${esc(u.name)}" data-key="${esc(u.key)}" data-scores="${scores ? '1' : '0'}" style="flex:1;min-width:132px;text-align:left;border-radius:10px;padding:12px;border:2px solid ${picked ? c : th.line};background:${picked ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'};"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:${c};">${sub}</div><div style="font-size:13px;font-weight:700;color:${th.text};margin-top:4px;line-height:1.25;">${esc(u.name)}</div>${picked ? `<div style="margin-top:6px;font-size:10.5px;font-weight:800;color:${c};display:flex;align-items:center;gap:5px;">${checkSvg(c, 12)}Winner</div>` : ''}</button>`;
        };
        const roundTabs = isBracket ? `<div style="display:flex;background:rgba(255,255,255,0.05);border:1px solid ${th.line};border-radius:9px;padding:3px;gap:3px;margin-bottom:13px;"><button data-act="refRound" data-round="round" style="flex:1;padding:9px;border-radius:6px;font-size:11.5px;font-weight:700;text-align:center;background:${round === 'round' ? T.A : 'transparent'};color:${round === 'round' ? T.on : th.sub};">Bracket round<br/><span style="font-size:9px;opacity:0.8;">${roundPts > 0 ? `+${roundPts} pts per win` : 'within tribe · no points'}</span></button><button data-act="refRound" data-round="champ" style="flex:1;padding:9px;border-radius:6px;font-size:11.5px;font-weight:700;text-align:center;background:${round === 'champ' ? T.A : 'transparent'};color:${round === 'champ' ? T.on : th.sub};">Championship<br/><span style="font-size:9px;opacity:0.8;">+${winPts} pts</span></button></div>` : '';
        const submitFor = (canSubmit, label) => `<button data-act="refWinnerSubmit" data-game="${esc(st.gameId)}" style="width:100%;margin-top:14px;background:${canSubmit ? T.A : 'rgba(255,255,255,0.08)'};color:${canSubmit ? T.on : th.sub};font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">${label}</button>`;
        let picker = '';
        let submitBtn = '';
        if (round === 'champ') {
          const done = isBracket ? results.filter(r => r.roundLabel === champName) : slotResults;
          const units = [...bufUnits, ...roadUnits];
          picker = `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin-bottom:9px;">Tap the winner${selSlot ? ' · ' + esc(selSlot.label) : ''} — earns ${winPts} pts</div>`;
          if (done.length) picker += scoredPanel(done) + '<div style="height:10px;"></div>';
          picker += units.length ? `<div style="display:flex;flex-wrap:wrap;gap:9px;">${units.map(u => unitBtn(u, true)).join('')}</div>` : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;">No one signed up for this slot.</div>`;
          submitBtn = submitFor(!!sel, !sel ? 'Tap the winner first' : `Log ${esc(sel.name)} win · +${winPts} pts`);
        } else {
          const roundChips = roundNames.length > 1 ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${roundNames.map(rn => `<button data-act="refRoundPick" data-round="${esc(rn)}" style="padding:7px 12px;border-radius:7px;font-size:11.5px;font-weight:700;background:${rn === selRound ? T.A : 'rgba(255,255,255,0.06)'};color:${rn === selRound ? T.on : th.sub};border:1px solid ${th.line};">${esc(rn)}</button>`).join('')}</div>` : '';
          const roundDone = results.filter(r => r.roundLabel === selRound);
          const tribeGroup = (label, units) => units.length ? `<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:${th.sub};margin:2px 0 6px;">${label} · pick the winner</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">${units.map(u => unitBtn(u, false)).join('')}</div>` : '';
          picker = `${roundChips}<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin-bottom:4px;">${esc(selRound)} · tap the winning ${isTeamGame ? 'team' : 'player'}</div><div style="font-size:11px;color:${th.sub};margin-bottom:10px;">${roundPts > 0 ? `Within-tribe — the winner advances and earns +${roundPts} pts for their tribe.` : 'Within-tribe — advances the winner, no tribe points until the championship.'}</div>${roundDone.length ? scoredPanel(roundDone) + '<div style="height:10px;"></div>' : ''}${(bufUnits.length + roadUnits.length) ? tribeGroup('Buffalo', bufUnits) + tribeGroup('Texas Roadhouse', roadUnits) : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;">No one signed up for this slot.</div>`}`;
          submitBtn = submitFor(!!sel, !sel ? 'Tap the winner first' : (roundPts > 0 ? `Log ${esc(sel.name)} — advances · +${roundPts} pts` : `Log ${esc(sel.name)} — advances`));
        }
        scorer = `<div style="height:1px;background:${th.line};margin:16px 0 14px;"></div>${roundTabs}${picker}${submitBtn}`;
      }

      // ── bracket progress — logged winners flow into the next round ──
      // Structured brackets (migration 012) build progress from the real
      // matches; legacy brackets fall back to the display rounds.
      const bracketProgress = matches ? (() => {
        const byRound = [];
        for (const m of matches) {
          const label = m.roundNo == null ? 'Sign-up slots' : (m.lane === 'final' ? 'Championship' : `Round ${m.roundNo}`);
          let grp = byRound.find(x => x.label === label);
          if (!grp) { grp = { label, isFinal: m.lane === 'final', ms: [] }; byRound.push(grp); }
          grp.ms.push(m);
        }
        const rows = byRound.map(gp => {
          const winners = gp.ms.flatMap(m => m.scored.map(r => r.playerName)).filter(Boolean);
          const doneN = gp.ms.filter(m => m.scored.length).length;
          const accent = gp.isFinal ? '#F5C518' : T.A;
          return `
          <div style="display:flex;gap:10px;padding:9px 0;border-top:1px solid ${th.line};">
            <div style="width:88px;flex-shrink:0;font-family:'BN Kragen';font-size:12.5px;color:${accent};padding-top:2px;line-height:1.15;">${esc(gp.label)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:700;color:${th.sub};">${doneN}/${gp.ms.length} match${gp.ms.length === 1 ? '' : 'es'} scored</div>
              ${winners.length ? `<div style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${green};margin-top:2px;">${checkSvg(green, 11)} ${gp.isFinal ? 'Champion' : 'Advancing'}: ${esc(winners.join(', '))}</div>` : `<div style="font-size:11px;color:${th.sub};margin-top:2px;">No winners logged yet.</div>`}
            </div>
          </div>`;
        }).join('');
        return `<div style="margin-top:16px;"><div style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A2};margin-bottom:6px;">🏆 Bracket progress</div>${rows}</div>`;
      })() : (isVs && isBracket && brData) ? (() => {
        const rows = brData.rounds.map((r, i) => {
          const winners = results.filter(x => x.roundLabel === r.name).map(x => x.playerName).filter(Boolean);
          const prevWinners = i > 0 ? results.filter(x => x.roundLabel === brData.rounds[i - 1].name).map(x => x.playerName).filter(Boolean) : [];
          const accent = r.team === 'final' ? '#F5C518' : T.A;
          return `
          <div style="display:flex;gap:10px;padding:9px 0;border-top:1px solid ${th.line};">
            <div style="width:72px;flex-shrink:0;font-family:'BN Kragen';font-size:12.5px;color:${accent};padding-top:2px;line-height:1.15;">${esc(r.time || '')}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12.5px;font-weight:800;color:${th.text};">${esc(r.name)}${r.team === 'final' ? ' 🏆' : ''}</div>
              ${winners.length
                ? `<div style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${green};margin-top:2px;">${checkSvg(green, 11)} ${r.team === 'final' ? 'Champion' : 'Advancing'}: ${esc(winners.join(', '))}</div>`
                : (prevWinners.length
                  ? `<div style="font-size:11px;color:${T.A2};font-weight:600;margin-top:2px;">In this round: ${esc(prevWinners.join(', '))}</div>`
                  : `<div style="font-size:11px;color:${th.sub};margin-top:2px;">${esc(r.detail || '')}</div>`)}
            </div>
          </div>`;
        }).join('');
        return `<div style="margin-top:16px;"><div style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A2};margin-bottom:6px;">🏆 Bracket progress</div>${rows}</div>`;
      })() : '';

      // Walk-up head-to-head — remind the ref how matchups form.
      const walkH2HNote = (st.openPlay && isVs) ? `<div style="margin-bottom:12px;display:flex;gap:8px;align-items:flex-start;background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.4);border-radius:9px;padding:10px 12px;"><span style="flex-shrink:0;">🤝</span><span style="font-size:11.5px;color:${th.text};line-height:1.45;">Walk-up head-to-head — players find someone from the <strong>other tribe</strong> to face. Score whichever matchup shows up.</span></div>` : '';

      // ── walk-up MATCHUP builder — for walk-up games played in teams (and any
      // walk-up head-to-head): pick each spot with a UNIQUE player, Buffalo side
      // vs TXRH side, then score the matchup. Replaces the one-name walk-on for
      // team games (one name was just duplicated across the team spots).
      const showMu = st.openPlay && (isVs || (st.teamSize || 1) >= 2);
      const muBlock = () => {
        const need = Math.max(1, st.teamSize || 1);
        const sideBox = (team) => {
          const c = teamColor(team);
          const picked = (S.mu[team] || []);
          const q = (S.muSearch[team] || '').trim().toLowerCase();
          const takenEverywhere = new Set([...(S.mu.buffalo || []), ...(S.mu.roadhouse || [])]);
          const opts = q ? allPlayers.filter(p => p.team === team && !takenEverywhere.has(p.name) && p.name.toLowerCase().includes(q)).slice(0, 4) : [];
          return `<div style="flex:1;min-width:150px;border:1px solid ${th.line};border-radius:10px;padding:11px 12px;background:rgba(255,255,255,0.03);">
            <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:${c};">${teamLabel(team)} · ${picked.length}/${need}</div>
            ${picked.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">${picked.map(nm => `<button data-act="muDrop" data-team="${team}" data-name="${esc(nm)}" style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:${th.text};background:rgba(255,255,255,0.07);border:1px solid ${th.line};border-radius:6px;padding:4px 8px;">${esc(nm)} <span style="color:${th.sub};">×</span></button>`).join('')}</div>` : ''}
            ${picked.length < need ? `
            <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid ${th.line};border-radius:8px;padding:8px 10px;margin-top:8px;">
              ${searchSvg(th.sub)}
              <input id="mu-in-${team}" data-live="${team === 'buffalo' ? 'muSearchB' : 'muSearchR'}" value="${esc(S.muSearch[team] || '')}" placeholder="Add player ${picked.length + 1} of ${need}…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${th.text};font-size:13px;font-family:'Montserrat';"/>
            </div>
            ${opts.length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-top:6px;">${opts.map(p => `<button data-act="muPick" data-team="${team}" data-name="${esc(p.name)}" style="text-align:left;font-size:12.5px;font-weight:700;color:${th.text};background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:7px;padding:8px 10px;">${esc(p.name)}</button>`).join('')}</div>` : ''}` : ''}
          </div>`;
        };
        const full = (S.mu.buffalo || []).length >= need && (S.mu.roadhouse || []).length >= need;
        let action = '';
        if (full && isVs) {
          const winBtn = (team) => {
            const picked = S.muWinner === team;
            const c = teamColor(team);
            return `<button data-act="muWinner" data-team="${team}" style="flex:1;text-align:left;border-radius:10px;padding:12px;border:2px solid ${picked ? c : th.line};background:${picked ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'};"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:${c};">${teamLabel(team)}</div><div style="font-size:12.5px;font-weight:700;color:${th.text};margin-top:3px;">${esc((S.mu[team] || []).join(' & '))}</div>${picked ? `<div style="margin-top:5px;font-size:10.5px;font-weight:800;color:${c};">${checkSvg(c, 11)} Winner</div>` : ''}</button>`;
          };
          action = `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin:12px 0 8px;">Who won? Winner earns ${winPts} pts</div><div style="display:flex;gap:9px;">${winBtn('buffalo')}${winBtn('roadhouse')}</div><button data-act="muSubmit" data-game="${esc(st.gameId)}" style="width:100%;margin-top:12px;background:${S.muWinner ? T.A : 'rgba(255,255,255,0.08)'};color:${S.muWinner ? T.on : th.sub};font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">${S.muWinner ? `Log ${S.muWinner === 'buffalo' ? 'Buffalo' : 'Texas Roadhouse'} win · +${winPts} pts` : 'Tap the winning side first'}</button>`;
        } else if (full) {
          action = `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${T.A};margin:12px 0 8px;">Enter each side's score</div><div style="display:flex;gap:9px;">${['buffalo', 'roadhouse'].map(tm => `<div style="flex:1;border:1px solid ${th.line};border-radius:10px;padding:10px;background:rgba(255,255,255,0.03);"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:${teamColor(tm)};">${teamLabel(tm)}</div><input data-muscore="${tm}" value="${S.muScores[tm] || ''}" inputmode="numeric" pattern="[0-9]*" placeholder="0" style="width:100%;margin-top:7px;text-align:center;background:rgba(255,255,255,0.06);border:1px solid ${th.line};border-radius:8px;padding:8px;color:${th.text};font-family:'BN Kragen';font-size:18px;outline:none;"/></div>`).join('')}</div><button data-act="muSubmit" data-game="${esc(st.gameId)}" style="width:100%;margin-top:12px;background:${T.A};color:${T.on};font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">Save matchup scores</button>`;
        } else {
          action = `<div style="margin-top:10px;font-size:11.5px;color:${th.sub};">Fill both sides (${need} per team) to score the matchup.</div>`;
        }
        return `<div style="height:1px;background:${th.line};margin:16px 0 14px;"></div>
          <div style="font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A};margin-bottom:9px;">➕ New walk-up matchup${need > 1 ? ` · ${need} per team` : ''}</div>
          <div style="display:flex;gap:9px;flex-wrap:wrap;">${sideBox('buffalo')}${sideBox('roadhouse')}</div>
          ${action}`;
      };

      body = walkH2HNote + slotPicker + scorer + (showMu ? muBlock() : '') + bracketProgress;
    }

    return `
    <div style="background:${rowBg};border:1px solid ${rowBorder};border-radius:12px;overflow:hidden;transition:all .15s;">
      <button data-act="refToggle" data-id="${esc(st.gameId)}" style="width:100%;display:flex;align-items:center;gap:13px;padding:14px 15px;">
        <div style="flex:1;min-width:0;text-align:left;">
          <div style="display:flex;align-items:center;gap:8px;"><span style="font-size:16px;font-weight:800;color:${th.text};line-height:1.05;">${esc(st.name)}</span>${allScored ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:9.5px;font-weight:800;letter-spacing:0.04em;color:${green};border:1px solid ${green};border-radius:5px;padding:2px 7px;">${checkSvg(green, 10, 3)}COMPLETE</span>` : ''}</div>
          <div style="font-size:11.5px;color:${th.sub};margin-top:4px;">${esc(st.timeLabel || '')} · ${esc(st.venue || '')}</div>
          <div style="display:inline-flex;align-items:center;gap:6px;margin-top:7px;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${statusColor};"><span style="width:6px;height:6px;border-radius:50%;background:${statusColor};"></span>${statusLabel} · ${typeLabel}</div>
        </div>
        <svg width="9" height="14" viewBox="0 0 8 14" style="flex-shrink:0;transform:${open ? 'rotate(90deg)' : 'rotate(0deg)'};transition:transform .18s;"><path d="M1 1l6 6-6 6" stroke="${th.sub}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${open ? `<div style="padding:0 15px 16px;"><div style="height:1px;background:${th.line};margin-bottom:14px;"></div>${body}</div>` : ''}
    </div>`;
  }).join('');

  return `
  <div style="padding:20px 0 24px;">
    <div style="padding:0 18px;">
      <div style="display:flex;align-items:center;gap:9px;">
        ${shieldSvg(T.A)}
        <span style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${T.A};">Ref HQ · your stations</span>
      </div>
      <h2 style="font-family:'BN Kragen';font-size:32px;color:${T.th.text};text-transform:uppercase;margin:8px 0 0;line-height:0.92;">Run the game.</h2>
      <p style="font-size:13px;color:${T.th.sub};margin:7px 0 0;">These are the games you're reffing. Tap one, pick the timeslot you're scoring, then log the result.</p>
    </div>
    <div style="padding:16px 18px 0;display:flex;flex-direction:column;gap:11px;">
      ${stations.length ? stationHtml : `<div style="background:rgba(255,255,255,0.04);border:1px solid ${T.th.line};border-radius:11px;padding:16px;font-size:13px;color:${T.th.sub};">No games assigned to you yet — grab one from the <strong style="color:${T.A};">Games</strong> tab, or an admin can assign you in the Admin Center.</div>`}
    </div>
    ${S.isDesk ? '' : `<div style="padding:24px 18px 0;"><button data-act="signOut" style="font-size:12px;font-weight:700;color:${T.th.sub};text-decoration:underline;">Sign out</button></div>`}
  </div>`;
}

/* ════════════════════ ref games tab — self-assign ════════════════════ */
function refGamesScreen() {
  const T = theme();
  const th = T.th;
  const games = S.boot.refGames || [];
  const mine = games.filter(g => g.mine);
  const others = games.filter(g => !g.mine);
  const card = (g) => {
    const refNames = g.refNames || (g.refName ? [g.refName] : []);
    return `
    <div style="background:rgba(255,255,255,0.04);border:1px solid ${g.mine ? T.A : th.line};border-radius:11px;padding:14px 15px;display:flex;align-items:center;gap:12px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:15px;font-weight:800;color:${th.text};">${esc(g.name)}</div>
        <div style="font-size:11.5px;color:${th.sub};margin-top:3px;">${esc(g.timeLabel || '')}${g.venue ? ` · ${esc(g.venue)}` : ''}${g.openPlay ? ' · Walk-up' : ''}</div>
        <div style="font-size:11px;font-weight:700;margin-top:5px;color:${g.mine ? T.A : (refNames.length ? th.sub : '#3FBF87')};">${g.mine ? (refNames.length > 1 ? `You + ${esc(refNames.length - 1)} other ref${refNames.length > 2 ? 's' : ''}` : "You're reffing this") : (refNames.length ? `Ref${refNames.length > 1 ? 's' : ''}: ${esc(refNames.join(', '))}` : 'No ref yet')}</div>
      </div>
      <button data-act="refClaim" data-game="${esc(g.gameId)}" data-claim="${g.mine ? '0' : '1'}" style="flex-shrink:0;font-size:12px;font-weight:800;padding:9px 13px;border-radius:8px;${g.mine ? `background:transparent;border:1px solid ${th.line};color:${th.sub};` : `background:${T.A};color:${T.on};`}">${g.mine ? 'Remove' : '+ Add to my list'}</button>
    </div>`;
  };
  return `
  <div style="padding:20px 0 24px;">
    <div style="padding:0 18px;">
      <div style="display:flex;align-items:center;gap:9px;">${shieldSvg(T.A)}<span style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${T.A};">Ref · build your list</span></div>
      <h2 style="font-family:'BN Kragen';font-size:32px;color:${th.text};text-transform:uppercase;margin:8px 0 0;line-height:0.92;">Cover a game</h2>
      <p style="font-size:13px;color:${th.sub};margin:7px 0 0;">Add any game to your list — it shows on your Home board. Any number of refs can cover the same game, so grab whatever you're near.</p>
    </div>
    <div style="padding:16px 18px 0;">
      ${mine.length ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${th.sub};margin-bottom:9px;">Your games</div><div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">${mine.map(card).join('')}</div>` : ''}
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${th.sub};margin-bottom:9px;">All games</div>
      <div style="display:flex;flex-direction:column;gap:10px;">${others.length ? others.map(card).join('') : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;">No other games.</div>`}</div>
    </div>
    ${S.isDesk ? '' : `<div style="padding:24px 18px 0;"><button data-act="signOut" style="font-size:12px;font-weight:700;color:${th.sub};text-decoration:underline;">Sign out</button></div>`}
  </div>`;
}

/* ════════════════════ games browser (mobile) ════════════════════ */
function gamesScreen() {
  const T = theme();
  const th = T.th;
  const boot = S.boot;
  const q = (S.gameSearch || '').trim().toLowerCase();
  const signupCount = myPickCount();
  const cats = [{ id: 'all', label: 'All' }, { id: 'signup', label: 'Sign-up' }, { id: 'walkup', label: 'Walk-up' }];
  const cat = S.cat && ['all', 'signup', 'walkup'].includes(S.cat) ? S.cat : 'all';
  const base = (boot.games || []).filter(g =>
    cat === 'all' || (cat === 'walkup' ? g.openPlay : !g.openPlay));
  const visible = base.filter(g => !q || (g.name + ' ' + (g.runtimeLabel || '') + ' ' + (g.venue || '')).toLowerCase().includes(q));
  const nGames = (boot.games || []).length;

  const cards = visible.map(g => {
    const gm = gameSummary(g);
    let status;
    if (gm.mine) status = `<span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;"><span style="display:flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#3FBF87;">${checkSvg('#3FBF87', 13)}You're in</span><span style="font-size:10.5px;color:${th.sub};">${esc(gm.mineLabel)}</span></span>`;
    else if (gm.hasSlots && gm.open > 0) status = `<span style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;"><span style="font-family:'BN Kragen';font-size:18px;color:${T.A};line-height:1;">${gm.open}</span><span style="font-size:9.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${th.sub};">spots open</span></span>`;
    else if (gm.openPlay) status = `<span style="font-size:10.5px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:${T.A};border:1px solid ${T.A};border-radius:6px;padding:6px 10px;text-align:center;display:block;">Walk up<br/>anytime</span>`;
    else status = `<span style="font-size:11px;font-weight:700;color:${th.sub};">Full</span>`;
    return `
    <button data-act="openGame" data-id="${esc(g.id)}" style="width:100%;text-align:left;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-left:3px solid ${gm.mine ? '#3FBF87' : T.A};border-radius:9px;padding:14px 15px;display:flex;align-items:center;gap:12px;">
      <div style="flex:1;min-width:0;">
        <div style="font-family:'BN Kragen';font-size:19px;color:${th.text};text-transform:uppercase;line-height:1;">${esc(g.name)}</div>
        <div style="display:flex;gap:10px;margin-top:7px;flex-wrap:wrap;align-items:center;">
          <span style="font-size:11.5px;color:${T.A};font-weight:700;">${esc(g.runtimeLabel || '')}</span>
          ${g.venue ? `<span style="font-size:11.5px;color:${th.sub};">${esc(g.venue)}</span>` : ''}
          ${gm.hasSlots ? `<span style="font-size:11.5px;color:${th.sub};">${g.slots.length} slots</span>` : ''}
          ${bracketFor(g) ? `<span style="font-size:10px;font-weight:800;letter-spacing:0.03em;text-transform:uppercase;color:#F5C518;border:1px solid rgba(245,197,24,0.5);border-radius:5px;padding:2px 6px;">🏆 Bracket</span>` : ''}
        </div>
      </div>
      <div style="flex-shrink:0;">${status}</div>
    </button>`;
  }).join('');

  return `
  <div style="padding:18px 0 24px;">
    <div style="padding:0 18px;">
      <span style="font-size:11px;font-weight:600;color:${T.A2};letter-spacing:0.04em;">${nGames} games · pick your time slots</span>
      <h2 style="font-family:'BN Kragen';font-size:36px;color:${th.text};text-transform:uppercase;margin:6px 0 0;line-height:0.92;">The Games</h2>
    </div>
    <div style="padding:15px 18px 0;">
      <div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:9px;padding:11px 13px;">
        ${searchSvg('#8AA7B9')}
        <input id="gs-input" data-live="gameSearch" value="${esc(S.gameSearch)}" placeholder="Search games, venues…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:${th.text};font-size:14px;font-family:'Montserrat';"/>
        ${S.gameSearch ? `<button data-act="clearSearch" style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.12);color:#C7D3DB;font-size:13px;display:flex;align-items:center;justify-content:center;">×</button>` : ''}
      </div>
    </div>
    <div style="padding:14px 18px 0;">
      <div style="display:flex;align-items:center;gap:11px;background:${th.panel};border:1px solid ${th.panelBorder};border-radius:10px;padding:12px 14px;">
        ${clipSvg(T.A, 20)}
        <div style="flex:1;min-width:0;">
          <div style="font-size:12.5px;font-weight:700;color:${th.text};">You've claimed ${signupCount} of ${signupMax()} game slots</div>
          <div style="font-size:11px;color:${th.sub};">Tap a game to pick a time slot. Up to ${signupMax()}, no overlapping times (walk-up games can overlap). Relay is separate.</div>
        </div>
      </div>
    </div>
    <div class="scrl" style="display:flex;gap:8px;overflow-x:auto;padding:16px 18px;">
      ${cats.map(c => `<button data-act="setCat" data-cat="${esc(c.id)}" style="flex-shrink:0;padding:8px 16px;border-radius:7px;font-size:12.5px;font-weight:700;white-space:nowrap;background:${c.id === cat ? T.A : 'rgba(255,255,255,0.06)'};color:${c.id === cat ? T.on : '#C7D3DB'};border:1px solid rgba(255,255,255,0.10);transition:all .15s;">${esc(c.label)}</button>`).join('')}
    </div>
    <div style="padding:0 18px;display:flex;flex-direction:column;gap:11px;">
      ${cards}
      ${visible.length === 0 ? `
      <div style="text-align:center;padding:34px 18px;">
        <div style="font-family:'BN Kragen';font-size:20px;color:#5C7B91;text-transform:uppercase;">No games found</div>
        <div style="font-size:12.5px;color:#8AA7B9;margin-top:6px;">Try a different word or clear the search.</div>
      </div>` : ''}
    </div>
  </div>`;
}

/* ════════════════════ game detail ════════════════════ */
function slotRowHtml(g, slot) {
  const T = theme();
  const th = T.th;
  const ss = slotState(slot, g);
  const team = myTeamKey();
  const myLabel = team === 'buffalo' ? 'Buffalo' : 'Texas Roadhouse';
  const otherLabel = team === 'buffalo' ? 'Texas Roadhouse' : 'Buffalo';
  const otherColor = team === 'buffalo' ? '#E0322E' : '#FF7F2E';

  // Team games (migration 011): the slot is split into Team 1 / Team 2 … per
  // tribe. The player joins a SPECIFIC team — that's how partners are chosen.
  if ((slot.teamSize || 1) >= 2) {
    const ts = slot.teamSize;
    const mode = S.boot.settings.eventMode;
    const myName = (S.boot.user && S.boot.user.name) || '';
    const myTeams = slotUnits(slot, team);
    const otherTeams = slotUnits(slot, team === 'buffalo' ? 'roadhouse' : 'buffalo');
    const mineIdx = myTeams.findIndex(u => u.members.includes(myName));
    const myTeamNo = mineIdx >= 0 ? myTeams[mineIdx].teamNo : null;
    const inThisSlot = myTeamNo != null || ss.st === 'signed';
    const gateLabel = ss.st === 'max' ? `Your ${signupMax()} slots are full`
      : ss.st === 'conflict' ? 'Overlaps a pick'
      : mode === 'gameday' ? 'Locked'
      : (ss.cap <= 0 ? `${myLabel} not in this slot` : '');
    const teamRow = (u) => {
      const full = u.members.length >= ts;
      const mineRow = myTeamNo != null && u.teamNo === myTeamNo;
      let act;
      if (mineRow) act = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;"><span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:#3FBF87;">${checkSvg('#3FBF87', 12)}You're in</span>${mode !== 'gameday' ? `<button data-act="leaveSlot" data-slot="${slot.id}" style="font-size:10.5px;color:${th.sub};text-decoration:underline;">Cancel</button>` : ''}</div>`;
      else if (inThisSlot) act = `<span style="flex-shrink:0;font-size:10.5px;color:${th.sub};">—</span>`;
      else if (full) act = `<span style="flex-shrink:0;font-size:11px;font-weight:700;color:${th.sub};">Full</span>`;
      else if (gateLabel) act = `<span style="flex-shrink:0;font-size:10.5px;font-weight:700;color:${th.sub};max-width:84px;text-align:right;">${esc(gateLabel)}</span>`;
      else act = `<button data-act="joinSlot" data-slot="${slot.id}" data-teamno="${u.teamNo}" style="flex-shrink:0;background:${T.A};color:${T.on};font-weight:800;font-size:12px;padding:8px 14px;border-radius:8px;">Join</button>`;
      return `<div style="background:${mineRow ? T.dim : 'rgba(255,255,255,0.03)'};border:1px solid ${mineRow ? T.A : th.line};border-radius:9px;padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:800;color:${th.text};">${esc(u.label)} <span style="font-size:11px;font-weight:700;color:${T.A};">${u.members.length}/${ts}</span></div>${u.members.length ? `<div style="font-size:11px;color:${th.sub};margin-top:2px;">${esc(u.members.join(' · '))}</div>` : `<div style="font-size:11px;color:${th.sub};margin-top:2px;font-style:italic;">Open — be the first</div>`}</div>
          ${act}
        </div>
      </div>`;
    };
    const otherFilled = otherTeams.reduce((a, u) => a + u.members.length, 0);
    return `
    <div style="background:${slot.mine ? T.dim : 'rgba(255,255,255,0.04)'};border:1px solid ${slot.mine ? T.A : th.line};border-radius:10px;padding:12px 14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="font-family:'BN Kragen';font-size:17px;color:${th.text};line-height:1;">${esc(slot.label)}</div>
        <span style="font-size:10.5px;font-weight:700;color:${otherColor};">${otherLabel} ${otherFilled}/${ss.otherCap}</span>
      </div>
      <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${th.sub};margin:9px 0 7px;">${myLabel} · pick your team (${ts} per team)</div>
      <div style="display:flex;flex-direction:column;gap:7px;">${myTeams.map(teamRow).join('')}</div>
      ${ss.overlap ? `<div style="margin-top:9px;display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;color:#F5C518;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M12 3 2 20h20L12 3z" stroke="#F5C518" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4M12 16.5v.5" stroke="#F5C518" stroke-width="2" stroke-linecap="round"/></svg>Overlaps another pick — fine for a walk-up, just finish inside the window.</div>` : ''}
    </div>`;
  }

  let action;
  if (ss.st === 'signed') action = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;"><span style="display:flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#3FBF87;">${checkSvg('#3FBF87', 13)}You're in</span>${S.boot.settings.eventMode !== 'gameday' ? `<button data-act="leaveSlot" data-slot="${slot.id}" style="font-size:10.5px;color:${th.sub};text-decoration:underline;">Cancel</button>` : ''}</div>`;
  else if (ss.st === 'open') action = `<button data-act="joinSlot" data-slot="${slot.id}" style="flex-shrink:0;background:${T.A};color:${T.on};font-weight:800;font-size:12.5px;padding:9px 15px;border-radius:8px;">Join</button>`;
  else if (ss.st === 'full') action = `<span style="flex-shrink:0;font-size:11px;font-weight:700;color:${th.sub};">Full</span>`;
  else if (ss.st === 'closed') action = `<span style="flex-shrink:0;font-size:10.5px;font-weight:700;color:${th.sub};max-width:80px;text-align:right;">${esc(myLabel)} not in this slot</span>`;
  else if (ss.st === 'max') action = `<span style="flex-shrink:0;font-size:10.5px;font-weight:700;color:${th.sub};max-width:78px;text-align:right;">Your ${signupMax()} slots are full</span>`;
  else if (ss.st === 'conflict') action = `<span style="flex-shrink:0;font-size:10.5px;font-weight:700;color:${th.sub};max-width:78px;text-align:right;">Overlaps a pick</span>`;
  else action = `<span style="flex-shrink:0;font-size:11px;font-weight:700;color:${th.sub};">Locked</span>`;

  const mine = ss.roster;
  return `
  <div style="background:${slot.mine ? T.dim : 'rgba(255,255,255,0.04)'};border:1px solid ${slot.mine ? T.A : th.line};border-radius:10px;padding:12px 14px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="flex:1;min-width:0;">
        <div style="font-family:'BN Kragen';font-size:17px;color:${th.text};line-height:1;">${esc(slot.label)}</div>
        <div style="display:flex;gap:12px;margin-top:6px;">
          <span style="font-size:11.5px;font-weight:700;color:${T.A};">${myLabel} ${ss.roster.length}/${ss.cap}</span>
          <span style="font-size:11.5px;font-weight:700;color:${otherColor};">${otherLabel} ${ss.otherRoster.length}/${ss.otherCap}</span>
        </div>
      </div>
      ${action}
    </div>
    ${ss.overlap ? `<div style="margin-top:9px;display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;color:#F5C518;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M12 3 2 20h20L12 3z" stroke="#F5C518" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4M12 16.5v.5" stroke="#F5C518" stroke-width="2" stroke-linecap="round"/></svg>Overlaps another pick — fine for a walk-up, just finish inside the window.</div>` : ''}
    ${mine.length ? `<div style="margin-top:9px;padding-top:8px;border-top:1px solid ${th.line};display:flex;flex-wrap:wrap;gap:6px;">${mine.map(n => `<span style="font-size:11px;font-weight:600;color:${th.text};background:rgba(255,255,255,0.06);border-radius:6px;padding:3px 8px;">${esc(n)}</span>`).join('')}</div>` : ''}
  </div>`;
}

// Bracket games run tribe-vs-tribe qualifiers, then each tribe's winner meets
// in a cross-tribe championship. This config drives the "Bracket path" panel so
// anyone who signs up can see the later round times in case they keep winning.
// Times are fixed per the event plan — edit here to adjust.
const BRACKETS = {
  cornhole: {
    intro: 'Cornhole is bracket play — you keep facing your own tribe until the title game. If you win, here\'s where you head next:',
    rounds: [
      { time: '1:30 – 2:00 PM', name: 'Qualifiers', detail: 'Buffalo vs Buffalo · Texas Roadhouse vs Texas Roadhouse', team: 'both' },
      { time: '2:30 PM', name: 'Semifinals', detail: 'Still within your own tribe', team: 'both' },
      { time: '3:00 PM', name: 'Championship', detail: 'Buffalo winner vs Texas Roadhouse winner', team: 'final' },
    ],
  },
  'ping-pong': {
    intro: 'Ping Pong is bracket play — each tribe runs its own bracket, then the two winners meet for the title:',
    rounds: [
      { time: '1:30 – 2:30 PM', name: 'Qualifiers', detail: 'Buffalo vs Buffalo · Texas Roadhouse vs Texas Roadhouse', team: 'both' },
      { time: '2:50 PM', name: 'Texas Roadhouse Semifinals', detail: 'Texas Roadhouse bracket', team: 'roadhouse' },
      { time: '3:10 PM', name: 'Buffalo Semifinals', detail: 'Buffalo bracket', team: 'buffalo' },
      { time: '3:30 PM', name: 'Championship', detail: 'Buffalo winner vs Texas Roadhouse winner', team: 'final' },
    ],
  },
};
// Resolve a game's bracket: prefer the DB-backed config (migration 009), fall
// back to the hard-coded BRACKETS by id when the payload predates 009 (isBracket
// undefined). A game the admin has explicitly un-bracketed (isBracket === false)
// resolves to null even if it has a legacy BRACKETS entry.
function bracketFor(g) {
  if (!g) return null;
  if (g.isBracket === false) return null;
  if (g.bracket && (g.bracket.rounds || []).length) return g.bracket;
  return BRACKETS[g.id] || null;
}
function bracketPanel(g) {
  const T = theme();
  const th = T.th;
  const br = bracketFor(g);
  if (!br) return '';
  const accentFor = (team) => team === 'final' ? '#F5C518'
    : team === 'buffalo' ? '#FF5F00'
    : team === 'roadhouse' ? '#E0322E'
    : T.A;
  const rounds = br.rounds.map((r, i) => {
    const last = i === br.rounds.length - 1;
    const accent = accentFor(r.team);
    return `
    <div style="display:flex;gap:12px;">
      <div style="width:84px;flex-shrink:0;text-align:right;padding-top:12px;">
        <div style="font-family:'BN Kragen';font-size:13.5px;color:${accent};line-height:1.1;">${esc(r.time)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
        <span style="width:12px;height:12px;border-radius:50%;background:${accent};margin-top:14px;"></span>
        ${last ? '' : '<span style="flex:1;width:2px;background:rgba(255,255,255,0.12);"></span>'}
      </div>
      <div style="flex:1;padding:8px 0 ${last ? '0' : '16px'};">
        <div style="background:rgba(255,255,255,0.04);border:1px solid ${r.team === 'final' ? accent : th.line};border-radius:9px;padding:11px 13px;">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <span style="font-family:'BN Kragen';font-size:15px;color:${th.text};text-transform:uppercase;line-height:1;">${esc(r.name)}</span>
            ${r.team === 'final' ? '<span style="font-size:13px;">🏆</span>' : ''}
          </div>
          <div style="font-size:11.5px;color:${th.sub};margin-top:4px;line-height:1.45;">${esc(r.detail)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  return `
  <div style="padding:20px 18px 0;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${T.A2};margin-bottom:8px;">🏆 Bracket path</div>
    <div style="font-size:11.5px;color:${th.sub};line-height:1.5;margin-bottom:14px;">${esc(br.intro)}</div>
    ${rounds}
  </div>`;
}

function gameDetailScreen() {
  const T = theme();
  const th = T.th;
  const g = (S.boot.games || []).find(x => x.id === S.routeArg);
  if (!g) return `<div style="padding:40px 18px;text-align:center;color:${th.sub};font-size:13px;">Game not found. <button data-act="go" data-to="games" style="color:${T.A};font-weight:700;text-decoration:underline;">Back to the games</button></div>`;

  const header = `
    <div style="padding:20px 18px 20px;background:linear-gradient(180deg, ${th.hero}, ${th.surface});position:relative;overflow:hidden;">
      <img src="/assets/logos/buffalo-white.png" alt="" style="position:absolute;right:-50px;top:-20px;width:200px;opacity:0.06;"/>
      <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A2};">${esc(g.runtimeLabel || '')}</span>
      <h2 style="font-family:'BN Kragen';font-size:34px;color:${th.text};text-transform:uppercase;margin:8px 0 0;line-height:0.92;">${esc(g.name)}</h2>
      ${g.venue ? `<div style="display:flex;align-items:center;gap:8px;margin-top:12px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" stroke="${T.A}" stroke-width="2"/><circle cx="12" cy="9" r="2.4" fill="${T.A}"/></svg>
        <span style="font-size:13px;color:#C7D3DB;font-weight:600;">${esc(g.venue)}</span></div>` : ''}
    </div>`;

  const hasSlots = (g.slots || []).length > 0;

  // Info block shown at the TOP of every game detail: players pill + points
  // pill, then "How to play", then the "See how it's played" video (if set).
  const playersPill = g.players ? `<span style="display:inline-block;font-size:12.5px;font-weight:600;color:${th.text};background:rgba(255,255,255,0.06);border:1px solid ${th.line};border-radius:9px;padding:8px 13px;">${esc(g.players)}</span>` : '';
  const pointsPill = g.pointsLabel ? `<span style="display:inline-block;font-size:12.5px;font-weight:800;color:${T.A};background:rgba(255,95,0,0.12);border:1px solid rgba(255,95,0,0.4);border-radius:9px;padding:8px 13px;">${esc(g.pointsLabel)}</span>` : '';
  const pills = (playersPill || pointsPill) ? `<div style="padding:14px 18px 0;display:flex;flex-wrap:wrap;gap:8px;">${playersPill}${pointsPill}</div>` : '';
  const howTo = g.descr ? `<div style="padding:16px 18px 0;"><div style="background:rgba(255,95,0,0.07);border:1px solid ${th.line};border-radius:10px;padding:14px 15px;"><div style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${T.A};margin-bottom:7px;">How to play</div><div style="font-size:13.5px;color:${th.text};line-height:1.55;white-space:pre-line;">${esc(g.descr)}</div></div></div>` : '';
  const video = g.videoUrl ? `<div style="padding:14px 18px 0;"><button data-act="openVideo" data-id="${esc(g.id)}" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:10px;padding:13px;color:${th.text};font-weight:800;font-size:13.5px;"><span style="width:30px;height:30px;border-radius:50%;background:${T.A};display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="13" height="13" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="${T.on}"/></svg></span>See how it's played</button></div>` : '';
  // Walk-up head-to-head: you bring your own opponent from the other tribe.
  const h2hNote = (g.openPlay && g.headToHead) ? `<div style="padding:14px 18px 0;"><div style="display:flex;align-items:flex-start;gap:9px;background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.4);border-radius:10px;padding:12px 14px;"><span style="flex-shrink:0;font-size:15px;">🤝</span><span style="font-size:12.5px;color:${th.text};line-height:1.5;">This one's head-to-head — <strong>find a person from the other tribe to compete with</strong>, then have the ref score your matchup.</span></div></div>` : '';
  const info = pills + howTo + video + h2hNote;

  // Pure walk-up game (no slots at all) — no sign-up, just show up.
  if (g.openPlay && !hasSlots) {
    return `<div style="padding:0 0 28px;">${header}${info}
      <div style="padding:18px;">
        <div style="text-align:center;background:${T.dim};border:1px dashed ${T.A};border-radius:12px;padding:22px 18px;">
          <div style="font-family:'BN Kragen';font-size:22px;color:${th.text};text-transform:uppercase;">Walk up anytime</div>
          <div style="font-size:13px;color:${th.sub};margin-top:8px;line-height:1.5;">No sign-up needed — just head over during the games and play. Your ref will score you on the spot.</div>
        </div>
      </div>
    </div>`;
  }

  // Zero-cap slots are bracket MATCH slots (later rounds / championship,
  // migration 012) — refs score them, players can't sign up for them; they show
  // in the Bracket path panel instead of the sign-up list.
  const slots = (g.slots || []).filter(s => (s.capBuffalo || 0) + (s.capRoadhouse || 0) > 0).map(s => slotRowHtml(g, s)).join('');
  const intro = g.openPlay
    ? `Grab a time slot to lock your run for <strong style="color:${th.text};">${esc(T.myTeamName)}</strong> — or just walk up during the window. After the window closes it's open walk-up for everyone. Walk-up slots may overlap another game you're in; that's OK, just leave yourself time to finish.`
    : `Reserve a time slot below for <strong style="color:${th.text};">${esc(T.myTeamName)}</strong>. You can arrive anytime during the game's window — after it, it's open walk-up. Up to ${signupMax()} game slots, and no overlapping times.`;
  return `<div style="padding:0 0 28px;">${header}
    ${info}
    <div style="padding:16px 18px 0;">
      <div style="display:flex;align-items:flex-start;gap:10px;background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:10px;padding:12px 14px;">
        ${clipSvg(T.A, 18)}
        <div style="font-size:11.5px;color:${th.sub};line-height:1.5;">${intro}</div>
      </div>
    </div>
    <div style="padding:14px 18px 0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${T.A2};margin-bottom:10px;">${g.openPlay ? 'Sign-up slots' : 'Time slots'}</div>
      <div style="display:flex;flex-direction:column;gap:9px;">${slots}</div>
    </div>
    ${bracketPanel(g)}
    ${g.needsRef ? `<div style="padding:16px 18px 0;"><div style="display:flex;align-items:center;gap:10px;background:${th.dim};border:1px solid ${T.A};border-radius:9px;padding:13px 15px;">${shieldSvg(T.A)}<span style="font-size:13.5px;font-weight:700;color:${th.text};">SUP ref required at this station</span></div></div>` : ''}
  </div>`;
}

/* ════════════════════ video modal ════════════════════ */
function videoModalHtml() {
  if (!S.videoOpen) return '';
  const vid = ytParse(S.videoOpen);
  const inner = vid
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?autoplay=1" style="width:100%;height:215px;border:0;display:block;" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`
    : `<div style="height:215px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px;background:radial-gradient(140px 100px at 50% 40%, rgba(255,95,0,0.18), transparent 72%), linear-gradient(160deg,#001b2e,#00101b);">
        <span style="width:56px;height:56px;border-radius:50%;background:#FF5F00;display:flex;align-items:center;justify-content:center;box-shadow:0 0 26px rgba(255,95,0,0.4);"><svg width="21" height="21" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#011220"/></svg></span>
        <a href="${esc(S.videoOpen)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:#E0322E;color:#fff;font-weight:800;font-size:13.5px;padding:11px 18px;border-radius:9px;text-decoration:none;"><svg width="18" height="13" viewBox="0 0 24 17"><rect x="1" y="1" width="22" height="15" rx="4" fill="#fff"/><path d="M10 5.5v6l5-3z" fill="#E0322E"/></svg>Open the demo on YouTube</a>
      </div>`;
  return `
  <div style="position:fixed;inset:0;z-index:2000;background:rgba(0,4,8,0.88);display:flex;flex-direction:column;justify-content:center;padding:20px;">
    <div style="width:100%;max-width:520px;margin:0 auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF7F2E;">See how it's played</span>
        <button data-act="closeVideo" style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.12);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;">×</button>
      </div>
      <div style="background:#000;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.14);">${inner}</div>
      <p style="font-size:11px;color:#8AA7B9;line-height:1.5;text-align:center;margin:13px 6px 0;">Organizers can paste a specific YouTube link for each game in the Admin Center → Games.</p>
    </div>
  </div>`;
}

/* ════════════════════ schedule ════════════════════ */
function scheduleScreen() {
  const T = theme();
  const th = T.th;
  const steel = '#8AA7B9';
  // Fixed, everyone-sees-them blocks the admin set (ceremonies, lunch, reveals)…
  const fixed = (S.boot.schedule || []).map(e => ({
    isGame: false, kind: e.kind, timeLabel: e.timeLabel, ampm: e.ampm,
    endLabel: e.endLabel || '', endAmpm: e.endAmpm || '',
    title: e.title, place: e.place, min: parseTimeLabel(`${e.timeLabel} ${e.ampm}`),
  }));
  // …woven together with THIS player's own game slots.
  const gameById = {};
  for (const g of (S.boot.games || [])) gameById[g.id] = g;
  const games = (S.boot.mySignups || []).map(m => {
    const g = gameById[m.gameId];
    return { isGame: true, kind: 'game', timeLabel: m.label, ampm: '', title: m.game, place: g ? g.venue : '', min: m.startMin };
  });
  // Dip Off cooks: their 11:30 AM drop-off is part of their day.
  if (S.boot.dip && S.boot.dip.myEntry) {
    games.push({ isGame: true, isDip: true, kind: 'game', timeLabel: '11:30', ampm: 'AM', title: 'Drop off your dip', place: 'The Cafe', min: 690 });
  }
  const all = [...fixed, ...games];
  all.forEach((it, i) => { it._i = i; });
  all.sort((a, b) => ((a.min == null ? Infinity : a.min) - (b.min == null ? Infinity : b.min)) || (a._i - b._i));

  const rows = all.map(e => {
    const live = e.kind === 'live';
    const done = e.kind === 'done';
    const game = e.isGame;
    const dot = game ? T.A : (live ? T.A : (done ? steel : '#011220'));
    const cardBg = game ? T.dim : (live ? th.panel : 'rgba(255,255,255,0.04)');
    const cardBorder = game ? T.A : (live ? T.A : 'rgba(255,255,255,0.08)');
    return `
    <div style="display:flex;gap:14px;">
      <div style="width:62px;flex-shrink:0;text-align:right;padding-top:14px;">
        <div style="font-family:'BN Kragen';font-size:15px;color:${game ? T.A : (live ? T.A : (done ? steel : th.text))};line-height:1;">${esc(e.timeLabel)}</div>
        ${e.ampm ? `<div style="font-size:10px;color:${steel};">${esc(e.ampm)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
        <span style="width:13px;height:13px;border-radius:50%;background:${dot};border:2px solid ${game || live ? T.A : steel};margin-top:15px;"></span>
        <span style="flex:1;width:2px;background:rgba(255,255,255,0.10);"></span>
      </div>
      <div style="flex:1;padding:10px 0 18px;">
        <div style="background:${cardBg};border:1px solid ${cardBorder};border-radius:9px;padding:13px 14px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-family:'BN Kragen';font-size:17px;color:${th.text};text-transform:uppercase;line-height:1;">${esc(e.title)}</span>
            ${game ? `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;color:${T.on};background:${T.A};border-radius:4px;padding:2px 6px;">${e.isDip ? 'DIP OFF' : 'YOUR GAME'}</span>` : ''}
            ${live ? `<span style="font-size:9px;font-weight:800;letter-spacing:0.08em;color:${T.on};background:${T.A};border-radius:4px;padding:2px 6px;">LIVE</span>` : ''}
          </div>
          ${!game && e.endLabel ? `<div style="font-size:11px;font-weight:700;color:${T.A2};margin-top:4px;">${esc(e.timeLabel)} ${esc(e.ampm)} – ${esc(e.endLabel)} ${esc(e.endAmpm)}</div>` : ''}
          ${e.place ? `<div style="font-size:12px;color:${steel};margin-top:5px;">${esc(e.place)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  return `
  <div style="padding:18px 0 24px;">
    <div style="padding:0 18px 8px;">
      <span style="font-size:11px;font-weight:600;color:${T.A2};letter-spacing:0.04em;">Thursday · August 14 · Support Center</span>
      <h2 style="font-family:'BN Kragen';font-size:36px;color:${th.text};text-transform:uppercase;margin:6px 0 0;line-height:0.92;">The Day</h2>
      <p style="font-size:12.5px;color:${th.sub};margin:8px 0 0;">Event moments everyone shares, plus the games you signed up for — woven together in time order.</p>
    </div>
    <div style="padding:18px;">${rows || `<div style="font-size:13px;color:${th.sub};font-style:italic;">Nothing scheduled yet.</div>`}</div>
  </div>`;
}

/* ════════════════════ tribes ════════════════════ */
function tribesScreen() {
  const T = theme();
  const th = T.th;
  // Team colours: Buffalo = navy/orange, Texas Roadhouse = red/yellow.
  const orange = '#FF5F00', navy = '#00253D', red = '#E0322E', yellow = '#F5C518';
  const isBuf = S.tribeTab === 'buffalo';
  const roster = ((S.boot.tribes || {})[S.tribeTab] || []).map(m => ({ ...m, initials: initials(m.name) }));
  const rolePillFg = isBuf ? '#FF7F2E' : yellow;
  const rolePillBorder = isBuf ? 'rgba(255,95,0,0.4)' : 'rgba(245,197,24,0.5)';
  const tribe = {
    name: isBuf ? 'Buffalo' : 'Texas Roadhouse',
    count: roster.length,
    mono: isBuf ? 'B' : 'TR',
    crestBg: isBuf ? orange : red,
    crestFg: isBuf ? '#011220' : yellow,
    crestSub: isBuf ? '#00253D' : 'rgba(255,255,255,0.82)',
    chipBg: isBuf ? '#011220' : yellow,
    chipFg: isBuf ? orange : red,
    bBg: isBuf ? orange : 'transparent', bFg: isBuf ? navy : '#C7D3DB', bBorder: isBuf ? orange : 'rgba(255,255,255,0.14)',
    rBg: !isBuf ? red : 'transparent', rFg: !isBuf ? yellow : '#C7D3DB', rBorder: !isBuf ? red : 'rgba(255,255,255,0.14)',
  };
  return `
  <div style="padding:18px 0 24px;">
    <div style="padding:0 18px;">
      <span style="font-size:11px;font-weight:600;color:${T.A2};letter-spacing:0.04em;">Two tribes · one champion</span>
      <h2 style="font-family:'BN Kragen';font-size:36px;color:${th.text};text-transform:uppercase;margin:6px 0 0;line-height:0.92;">The Tribes</h2>
    </div>
    <div style="padding:16px 18px;display:flex;gap:8px;">
      <button data-act="tribeTab" data-tab="buffalo" style="flex:1;padding:10px;border-radius:8px;font-weight:700;font-size:13px;background:${tribe.bBg};color:${tribe.bFg};border:1px solid ${tribe.bBorder};transition:all .15s;">Buffalo</button>
      <button data-act="tribeTab" data-tab="roadhouse" style="flex:1;padding:10px;border-radius:8px;font-weight:700;font-size:13px;background:${tribe.rBg};color:${tribe.rFg};border:1px solid ${tribe.rBorder};transition:all .15s;">Texas Roadhouse</button>
    </div>
    <div style="padding:0 18px;">
      <div style="background:${tribe.crestBg};border-radius:12px;padding:20px;display:flex;align-items:center;justify-content:space-between;overflow:hidden;position:relative;">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${tribe.crestSub};">${tribe.count} teammates</div>
          <div style="font-family:'BN Kragen';font-size:32px;color:${tribe.crestFg};text-transform:uppercase;line-height:0.95;margin-top:4px;">${tribe.name}</div>
        </div>
        <div style="width:58px;height:58px;border-radius:50%;border:2px solid ${tribe.crestFg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-family:'BN Kragen';font-size:21px;color:${tribe.crestFg};">${tribe.mono}</span>
        </div>
      </div>
    </div>
    <div style="padding:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#8AA7B9;margin-bottom:10px;">Roster · ${tribe.count} strong</div>
      <div style="display:flex;flex-direction:column;gap:9px;">
        ${roster.length ? roster.map(m => `
        <div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 13px;">
          <span style="width:36px;height:36px;border-radius:8px;background:${tribe.chipBg};color:${tribe.chipFg};display:flex;align-items:center;justify-content:center;font-family:'BN Kragen';font-size:14px;flex-shrink:0;">${esc(m.initials)}</span>
          <span style="flex:1;font-size:14px;font-weight:600;color:${th.text};">${esc(m.name)}</span>
          ${m.role ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${rolePillFg};border:1px solid ${rolePillBorder};border-radius:5px;padding:3px 7px;">${esc(m.role)}</span>` : ''}
        </div>`).join('') : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;">No one on this roster yet.</div>`}
      </div>
    </div>
  </div>`;
}

/* ════════════════════ score room (player) ════════════════════ */
function scoreScreen() {
  const T = theme();
  const th = T.th;
  const scores = S.boot.scores || { revealed: false };
  const myResults = (S.boot.myResults || []).map(r => ({ ...r, ptsLabel: r.pts > 0 ? ('+' + r.pts) : '—' }));
  const myPoints = myResults.reduce((a, r) => a + (r.pts || 0), 0);

  const banner = scores.revealed ? `
    <div style="margin:16px 18px 0;">
      <div style="background:${th.hero};border:1px solid ${T.A};border-radius:11px;padding:16px;position:relative;overflow:hidden;">
        <div style="position:absolute;inset:0;background:radial-gradient(220px 120px at 50% 0%, ${T.glow}, transparent 70%);"></div>
        <div style="position:relative;font-family:'BN Kragen';font-size:18px;color:${th.text};text-transform:uppercase;line-height:1;margin-bottom:12px;">Final standings</div>
        <div style="position:relative;display:flex;gap:11px;">
          <div style="flex:1;background:#FF5F00;border-radius:10px;padding:14px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#00253D;">Buffalo</div>
            <div style="font-family:'BN Kragen';font-size:38px;color:#011220;line-height:0.9;margin-top:4px;">${scores.buffalo}</div>
          </div>
          <div style="flex:1;background:#141210;border-radius:10px;padding:14px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#F5C518;">Texas Roadhouse</div>
            <div style="font-family:'BN Kragen';font-size:38px;color:#E0322E;line-height:0.9;margin-top:4px;">${scores.roadhouse}</div>
          </div>
        </div>
        <div style="position:relative;font-size:11.5px;color:${th.sub};margin-top:10px;">${scores.buffalo === scores.roadhouse ? "Dead even — anyone's game" : (scores.buffalo > scores.roadhouse ? 'Buffalo leads by ' + (scores.buffalo - scores.roadhouse) : 'Texas Roadhouse leads by ' + (scores.roadhouse - scores.buffalo))}</div>
      </div>
    </div>` : `
    <div style="margin:16px 18px 0;background:${th.hero};border:1px solid ${T.A};border-radius:11px;padding:16px;display:flex;align-items:center;gap:13px;position:relative;overflow:hidden;">
      <div style="position:absolute;inset:0;background:radial-gradient(220px 120px at 50% 0%, ${T.glow}, transparent 70%);"></div>
      ${lockSvg(T.A, 26).replace('style="flex-shrink:0;"', 'style="position:relative;flex-shrink:0;"')}
      <div style="position:relative;">
        <div style="font-family:'BN Kragen';font-size:18px;color:${th.text};text-transform:uppercase;line-height:1;">Scores are sealed</div>
        <div style="font-size:11.5px;color:${th.sub};margin-top:4px;">Standings stay locked until the Closing Ceremony · 4:00 PM</div>
      </div>
    </div>`;

  return `
  <div style="padding:18px 0 24px;">
    <div style="padding:0 18px;">
      <span style="font-size:11px;font-weight:600;color:${T.A2};letter-spacing:0.04em;">${scores.revealed ? 'The board is live' : 'Sealed until the 4:00 PM reveal'}</span>
      <h2 style="font-family:'BN Kragen';font-size:36px;color:${th.text};text-transform:uppercase;margin:6px 0 0;line-height:0.92;">Score Room</h2>
    </div>
    ${banner}
    <div style="padding:20px 18px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${th.sub};">Your results</span>
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span style="font-family:'BN Kragen';font-size:22px;color:${T.A};line-height:1;">${myPoints}</span>
          <span style="font-size:11px;color:${th.sub};">your pts</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:9px;">
        ${myResults.length ? myResults.map(r => `
        <div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:11px 13px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13.5px;font-weight:700;color:${th.text};">${esc(r.game)}</div>
            <div style="font-size:11px;color:${th.sub};">${esc(r.detail || '')}</div>
          </div>
          <span style="font-family:'BN Kragen';font-size:17px;color:${T.A};">${esc(r.ptsLabel)}</span>
        </div>`).join('') : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;">No personal results logged yet — go play something.</div>`}
      </div>
      <div style="margin-top:14px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.18);border-radius:10px;padding:13px 15px;display:flex;align-items:center;gap:11px;">
        ${lockSvg('#8AA7B9', 18)}
        <span style="font-size:12.5px;color:${th.sub};line-height:1.4;">These are your personal scores. The full team standings ${scores.revealed ? 'are live above.' : 'stay locked until an admin releases them at the Closing Ceremony.'}</span>
      </div>
    </div>
  </div>`;
}

/* ════════════════════ immunity (admin-managed idol clues) ════════════════════ */
// Clues are HIDDEN by default. A clue reveals once its release time passes on
// the viewer's own clock, or once an admin marks it found. Status is derived:
//   found  → claimed (clue shown, "Found" badge)
//   locked → release time not reached (or none set) → clue text hidden
//   open   → released → clue text shown
function idolStatus(idol, nowMin) {
  if (idol.found) return 'found';
  if (idol.releaseMin != null && nowMin >= idol.releaseMin) return 'open';
  return 'locked';
}
function immunityScreen() {
  const T = theme();
  const th = T.th;
  const steel = '#8AA7B9', muted = '#5C7B91', bone = th.text;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const idols = (S.boot.idols || []).map((idol, i) => {
    const st = idolStatus(idol, nowMin);
    const found = st === 'found', open = st === 'open', locked = st === 'locked';
    const hint = found ? 'Claimed — idol secured'
      : open ? (idol.clue || 'Active — solve to claim')
      : (idol.releaseMin != null ? `Unlocks at ${minToLabel(idol.releaseMin)}` : 'Hidden — not yet released');
    return {
      num: i + 1,
      title: found || open ? (idol.clue || idol.title || `Clue ${i + 1}`) : (idol.title || `Clue ${i + 1}`),
      hint,
      showClueAsTitle: found || open,
      bg: open ? th.dim : 'rgba(255,255,255,0.04)',
      border: open ? T.A : 'rgba(255,255,255,0.08)',
      iconBg: found ? T.A : (open ? th.dim : 'rgba(255,255,255,0.08)'),
      numColor: found ? T.on : (open ? T.A : steel),
      titleColor: locked ? steel : bone,
      tag: found ? 'Found' : (open ? 'Open' : 'Locked'),
      tagColor: found ? T.A2 : (open ? T.A : muted),
    };
  });
  const total = idols.length;
  const foundCount = (S.boot.idols || []).filter(x => x.found).length;
  return `
  <div style="padding:0 0 28px;">
    <div style="position:relative;padding:26px 18px 24px;background:${th.hero};overflow:hidden;">
      <div style="position:absolute;inset:0;background:radial-gradient(360px 240px at 50% 0%, ${T.glow}, transparent 70%);"></div>
      <div style="position:relative;text-align:center;">
        <svg width="40" height="44" viewBox="0 0 24 24" fill="none" style="margin-bottom:8px;"><path d="M12 2l8 3.5v6C20 17 16.5 21 12 22.5 7.5 21 4 17 4 11.5v-6L12 2z" stroke="${T.A}" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 11.8l2 2 3.6-4" stroke="${T.A}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span style="display:block;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${T.A2};">Hidden immunity</span>
        <h2 style="font-family:'BN Kragen';font-size:34px;color:${th.text};text-transform:uppercase;margin:7px 0 0;line-height:0.92;">Find the Idols</h2>
        <p style="font-size:13.5px;line-height:1.55;color:#C7D3DB;max-width:290px;margin:12px auto 0;">Clues are hidden across the Support Center and unlock through the day. Crack one to claim an idol — each is worth immunity and bonus points for your tribe.</p>
      </div>
    </div>
    <div style="padding:18px;">
      <div style="background:rgba(255,95,0,0.10);border:1px solid rgba(255,95,0,0.4);border-radius:10px;padding:15px;display:flex;align-items:center;gap:14px;">
        <div style="font-family:'BN Kragen';font-size:38px;color:#FF5F00;line-height:0.9;">${foundCount}<span style="font-size:19px;color:#8AA7B9;">/${total}</span></div>
        <div>
          <div style="font-size:13px;font-weight:700;color:${th.text};">Idols claimed so far</div>
          <div style="font-size:11.5px;color:#8AA7B9;margin-top:2px;">Each one earns points for the finder's tribe · who's holding them stays secret until Tribal Council</div>
        </div>
      </div>
      <div style="margin-top:11px;display:flex;align-items:flex-start;gap:10px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.20);border-radius:10px;padding:13px 15px;">
        <span style="font-size:16px;flex-shrink:0;">🤫</span>
        <span style="font-size:12px;color:#C7D3DB;line-height:1.5;">Psst — there are <strong style="color:${th.text};">other idols hidden around camp with no clues at all</strong>. Find one and it gives your tribe an advantage in the relay race.</span>
      </div>
    </div>
    <div style="padding:0 18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#8AA7B9;margin-bottom:11px;">The clues</div>
      <div style="display:flex;flex-direction:column;gap:9px;">
        ${total ? idols.map(cl => `
        <div style="display:flex;align-items:center;gap:13px;background:${cl.bg};border:1px solid ${cl.border};border-radius:9px;padding:13px;">
          <span style="width:30px;height:30px;border-radius:50%;background:${cl.iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'BN Kragen';font-size:13px;color:${cl.numColor};">${cl.num}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13.5px;font-weight:700;color:${cl.titleColor};">${esc(cl.title)}</div>
            <div style="font-size:11.5px;color:#8AA7B9;margin-top:2px;">${esc(cl.hint)}</div>
          </div>
          <span style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${cl.tagColor};flex-shrink:0;">${cl.tag}</span>
        </div>`).join('') : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;padding:6px 2px;">No clues released yet — check back through the day.</div>`}
      </div>
    </div>
    <div style="margin:20px 18px 0;background:${T.A};border-radius:10px;padding:15px;text-align:center;box-shadow:0 0 28px ${T.glow};">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${T.on};">Final reveal</div>
      <div style="font-family:'BN Kragen';font-size:20px;color:${T.on};margin-top:3px;text-transform:uppercase;">Tribal Council · 3:30 PM</div>
    </div>
  </div>`;
}

/* ════════════════════ dip off — sign up ════════════════════ */
function dipSignupScreen() {
  const T = theme();
  const th = T.th;
  const dip = S.boot.dip || { counts: { buffalo: 0, roadhouse: 0 }, entries: [], myEntry: false };
  const myTeam = S.boot.user.team || 'buffalo';
  const myDipCount = dip.counts[myTeam] || 0;
  const iSigned = !!dip.myEntry;
  const teamFull = myDipCount >= 5 && !iSigned;
  const canSign = !iSigned && !teamFull && S.boot.settings.eventMode !== 'gameday';
  const myList = (dip.entries || []).filter(d => d.team === myTeam);

  let action = '';
  if (iSigned) action = `
    <div style="background:${T.dim};border:1px solid ${T.A};border-radius:11px;padding:16px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${T.A}" stroke-width="2"/><path d="M8 12l3 3 5-6" stroke="${T.A}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div style="flex:1;"><div style="font-size:14.5px;font-weight:800;color:${th.text};">You're on the cook list</div><div style="font-size:11.5px;color:${th.sub};">Bring your dip to the Cafe before 11:30.</div></div>
      </div>
      ${S.boot.settings.eventMode !== 'gameday' ? `<button data-act="dipLeave" style="width:100%;margin-top:13px;background:transparent;border:1px solid ${th.line};color:${th.sub};font-weight:700;font-size:13px;text-align:center;padding:11px;border-radius:8px;">Drop out of the Dip Off</button>` : ''}
    </div>`;
  else if (canSign) action = `
    <button data-act="dipEnter" style="width:100%;background:${T.A};color:${T.on};border-radius:11px;padding:16px;display:flex;align-items:center;gap:13px;box-shadow:0 8px 22px ${T.glow};">
      ${dipSvg(T.on)}
      <div style="flex:1;text-align:left;"><div style="font-size:15px;font-weight:800;">Sign up to make a dip</div><div style="font-size:11.5px;opacity:0.82;">${5 - myDipCount} of 5 spots left for your tribe</div></div>
    </button>`;
  else if (teamFull) action = `
    <div style="background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:11px;padding:16px;text-align:center;">
      <div style="font-size:13.5px;font-weight:700;color:${th.text};">Your tribe's 5 cook spots are full</div>
      <div style="font-size:11.5px;color:${th.sub};margin-top:3px;">Come hungry — you can still vote on judging day.</div>
    </div>`;
  else action = `
    <div style="background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:11px;padding:16px;text-align:center;">
      <div style="font-size:13.5px;font-weight:700;color:${th.text};">Game Day — the cook list is locked</div>
      <div style="font-size:11.5px;color:${th.sub};margin-top:3px;">Head to the Cafe at 11:30 and vote for your favorite.</div>
    </div>`;

  return `
  <div style="padding:0 0 28px;">
    <div style="padding:20px 18px 20px;background:linear-gradient(180deg, ${th.hero}, ${th.surface});position:relative;overflow:hidden;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A2};">Wild Card · The Cafe</span>
      <h2 style="font-family:'BN Kragen';font-size:34px;color:${th.text};text-transform:uppercase;margin:8px 0 0;line-height:0.92;">The Dip Off</h2>
      <p style="font-size:13.5px;line-height:1.55;color:#C7D3DB;max-width:300px;margin:11px 0 0;">Five cooks per tribe bring their best dip. Judging is at 11:30 — then the whole camp votes for a favorite.</p>
    </div>
    <div style="padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:14px;">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FF7F2E;">Buffalo</div>
        <div style="font-family:'BN Kragen';font-size:30px;color:${th.text};line-height:1;margin-top:6px;">${dip.counts.buffalo || 0}<span style="font-size:16px;color:#8AA7B9;"> / 5</span></div>
        <div style="font-size:11px;color:#8AA7B9;margin-top:3px;">cooks signed up</div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:14px;">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#E0322E;">Texas Roadhouse</div>
        <div style="font-family:'BN Kragen';font-size:30px;color:${th.text};line-height:1;margin-top:6px;">${dip.counts.roadhouse || 0}<span style="font-size:16px;color:#8AA7B9;"> / 5</span></div>
        <div style="font-size:11px;color:#8AA7B9;margin-top:3px;">cooks signed up</div>
      </div>
    </div>
    <div style="padding:0 18px;">${action}</div>
    <div style="padding:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8AA7B9;margin-bottom:10px;">Your tribe's cooks</div>
      ${myList.length ? `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${myList.map(c => `
        <div style="display:flex;align-items:center;gap:11px;background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:9px;padding:11px 13px;">
          <span style="width:30px;height:30px;border-radius:50%;background:${T.dim};display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 11h16M5 11a7 7 0 0014 0M8 20h8" stroke="${T.A}" stroke-width="2" stroke-linecap="round"/></svg></span>
          <span style="flex:1;font-size:13.5px;font-weight:700;color:${th.text};">${esc(c.name || ('Dip No. ' + c.no))}</span>
          ${c.isMine ? `<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;color:${T.on};background:${T.A};border-radius:4px;padding:3px 7px;">YOU</span>` : ''}
        </div>`).join('')}
      </div>` : `<div style="font-size:12.5px;color:${th.sub};font-style:italic;">No cooks yet — be the first to sign up.</div>`}
      <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding:11px 13px;background:rgba(255,255,255,0.03);border:1px dashed ${th.line};border-radius:9px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" stroke="${th.sub}" stroke-width="1.8"/></svg>
        <span style="font-size:11.5px;color:${th.sub};line-height:1.4;">Cooks stay anonymous to voters — dips are numbered until the results are read.</span>
      </div>
    </div>
  </div>`;
}

/* ════════════════════ dip off — vote ════════════════════ */
function dipVoteScreen() {
  const T = theme();
  const th = T.th;
  const dip = S.boot.dip || { entries: [], myVote: null };
  const entries = dip.entries || [];
  const myVote = dip.myVote;
  const isGameDay = S.boot.settings.eventMode === 'gameday';
  const myIdx = entries.findIndex(d => d.id === myVote);
  const myDipVoteNo = myIdx >= 0 ? myIdx + 1 : 0;

  return `
  <div style="padding:0 0 28px;">
    <div style="padding:20px 18px 20px;background:linear-gradient(180deg, ${th.hero}, ${th.surface});position:relative;overflow:hidden;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A2};">Game Day · The Cafe</span>
      <h2 style="font-family:'BN Kragen';font-size:34px;color:${th.text};text-transform:uppercase;margin:8px 0 0;line-height:0.92;">Vote a Dip</h2>
      <p style="font-size:13.5px;line-height:1.55;color:#C7D3DB;max-width:300px;margin:11px 0 0;">Taste the whole spread, then cast your one vote. Dips are numbered and anonymous until the reveal.</p>
    </div>
    ${!isGameDay ? `
    <div style="margin:16px 18px 0;background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:10px;padding:13px 15px;font-size:12.5px;color:${th.sub};">Voting opens on Game Day — for now, check out the cook list on the Dip Off page.</div>` : ''}
    ${myVote ? `
    <div style="margin:16px 18px 0;background:${T.dim};border:1px solid ${T.A};border-radius:10px;padding:13px 15px;display:flex;align-items:center;gap:10px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="${T.A}" stroke-width="2"/><path d="M8 12l3 3 5-6" stroke="${T.A}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="font-size:12.5px;font-weight:700;color:${th.text};">Your vote's in for Dip No. ${myDipVoteNo}. Tap another to change it.</span>
    </div>` : ''}
    <div style="padding:16px 18px 0;display:grid;grid-template-columns:1fr 1fr;gap:11px;">
      ${entries.map((d, i) => {
        const mine = d.id === myVote;
        return `
        <button data-act="dipVote" data-id="${d.id}" style="background:${mine ? T.dim : 'rgba(255,255,255,0.04)'};border:1.5px solid ${mine ? T.A : 'rgba(255,255,255,0.10)'};border-radius:12px;padding:16px 13px;text-align:center;transition:all .15s;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${mine ? T.A2 : th.sub};">Dip</div>
          <div style="font-family:'BN Kragen';font-size:40px;line-height:0.9;color:${mine ? T.A : th.text};margin-top:3px;">${i + 1}</div>
          <div style="margin-top:11px;font-size:12px;font-weight:800;color:${mine ? T.A : th.sub};display:flex;align-items:center;justify-content:center;gap:6px;">
            ${mine ? checkSvg(T.A, 14, 2.6) + 'Your vote' : 'Tap to vote'}
          </div>
        </button>`;
      }).join('')}
      ${entries.length === 0 ? `<div style="grid-column:1/-1;font-size:12.5px;color:${th.sub};font-style:italic;">No dips entered — the ballot builds from the sign-up list.</div>` : ''}
    </div>
    <div style="padding:16px 18px 0;">
      <div style="display:flex;align-items:center;gap:8px;padding:11px 13px;background:rgba(255,255,255,0.03);border:1px dashed ${th.line};border-radius:9px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="9" stroke="${th.sub}" stroke-width="1.8"/><path d="M12 8v5" stroke="${th.sub}" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="${th.sub}"/></svg>
        <span style="font-size:11.5px;color:${th.sub};line-height:1.4;">One vote per person. The winning dip is revealed at the 4:00 closing ceremony.</span>
      </div>
    </div>
  </div>`;
}

/* ════════════════════ relay race ════════════════════ */
function relayScreen() {
  const T = theme();
  const th = T.th;
  const relay = S.boot.relay || { legs: [], roster: {}, myLeg: null };
  const myTeam = S.boot.user.team || 'buffalo';
  const isGameDay = S.boot.settings.eventMode === 'gameday';
  const hasPick = !!relay.myLeg;
  const myLegObj = (relay.legs || []).find(l => l.id === relay.myLeg);

  const legs = (relay.legs || []).map(l => {
    const r = (relay.roster || {})[l.id] || { buffalo: [], roadhouse: [] };
    const mineList = r[myTeam] || [];
    const iAmHere = relay.myLeg === l.id;
    const full = mineList.length >= l.cap;
    const rosterNames = mineList.length ? mineList.join(' · ') : 'No one yet — be first';
    let btn = '';
    if (iAmHere) btn = `<button data-act="relayLeave" style="flex-shrink:0;background:${T.A};color:${T.on};font-weight:800;font-size:12px;padding:8px 14px;border-radius:8px;display:flex;align-items:center;gap:5px;">${checkSvg(T.on, 13, 2.6)}You're in</button>`;
    else if (full) btn = `<span style="flex-shrink:0;font-size:11.5px;font-weight:700;color:${th.sub};">Leg full</span>`;
    else if (isGameDay) btn = `<span style="flex-shrink:0;font-size:11.5px;font-weight:700;color:${th.sub};">Locked</span>`;
    else btn = `<button data-act="relayJoin" data-id="${esc(l.id)}" style="flex-shrink:0;background:rgba(255,255,255,0.06);border:1px solid ${T.A};color:${T.A};font-weight:800;font-size:12px;padding:8px 14px;border-radius:8px;">${hasPick ? 'Switch here' : 'Sign up'}</button>`;
    return `
    <div style="background:${th.panel};border:1px solid ${iAmHere ? T.A : th.panelBorder};border-radius:11px;padding:15px 16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:15px;font-weight:800;color:${th.text};">${esc(l.name)}</div>
          <div style="font-size:12px;color:${th.sub};line-height:1.45;margin-top:4px;">${esc(l.desc || '')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-family:'BN Kragen';font-size:20px;color:${T.A};line-height:1;">${mineList.length} / ${l.cap}</div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${th.sub};margin-top:3px;">${full ? 'Full' : (l.cap - mineList.length) + ' left'}</div>
        </div>
      </div>
      <div style="margin-top:11px;padding-top:10px;border-top:1px solid ${th.line};display:flex;align-items:center;gap:10px;">
        <span style="flex:1;font-size:11.5px;color:${th.sub};min-width:0;">${esc(rosterNames)}</span>
        ${btn}
      </div>
    </div>`;
  }).join('');

  return `
  <div style="padding:0 0 28px;">
    <div style="padding:20px 18px 20px;background:linear-gradient(180deg, ${th.hero}, ${th.surface});position:relative;overflow:hidden;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${T.A2};">Field Finale · Before Closing</span>
      <h2 style="font-family:'BN Kragen';font-size:34px;color:${th.text};text-transform:uppercase;margin:8px 0 0;line-height:0.92;">The Relay</h2>
      <p style="font-size:13.5px;line-height:1.55;color:#C7D3DB;max-width:300px;margin:11px 0 0;">One big race, several legs. Sign up for <strong style="color:${th.text};">one leg only</strong> — even if you're already in other games.</p>
    </div>
    <div style="padding:16px 18px 0;">
      ${hasPick ? `
      <div style="background:${T.dim};border:1px solid ${T.A};border-radius:10px;padding:13px 15px;display:flex;align-items:center;gap:10px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 8l4 2-2 4 5 1 1 4M14 5a1.5 1.5 0 100-.01" stroke="${T.A}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span style="font-size:12.5px;font-weight:700;color:${th.text};">You're running: ${esc(myLegObj ? myLegObj.name : '')}</span>
      </div>` : `
      <div style="background:rgba(255,255,255,0.04);border:1px solid ${th.line};border-radius:10px;padding:13px 15px;font-size:12.5px;color:${th.sub};">Pick the one leg you'll run for your tribe.</div>`}
    </div>
    <div style="padding:14px 18px 0;display:flex;flex-direction:column;gap:11px;">${legs}</div>
  </div>`;
}

/* ════════════════════ desktop games board (≥940px) ════════════════════ */
function deskGamesScreen() {
  const T = theme();
  const boot = S.boot;
  const user = boot.user;
  const isGameDay = boot.settings.eventMode === 'gameday';
  const dA = T.deskAccent, dOn = T.deskAccentOn, dDim = T.deskAccentDim;
  const myName = user.name || '';

  const mkCard = (g) => {
    const gm = gameSummary(g);
    const signed = gm.mine;
    const rowBg = signed ? dDim : '#fff';
    const rowBorder = signed ? dA : '#E4EAE8';
    let status;
    if (signed) status = `<div style="text-align:center;background:${dDim};border:1px solid ${dA};color:${dA};font-weight:800;font-size:12px;padding:9px;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:6px;">${checkSvg(dA, 14, 2.6)}You're in · ${esc(gm.mineLabel)}</div>`;
    else if (gm.hasSlots && gm.open > 0) status = `<div style="text-align:center;background:#fff;border:1px solid ${dA};color:${dA};font-weight:800;font-size:12px;padding:9px;border-radius:8px;">${gm.open} spots open · pick a slot</div>`;
    else if (gm.openPlay) status = `<div style="text-align:center;background:${dDim};border:1px dashed ${dA};color:${dA};font-weight:800;font-size:11.5px;padding:9px;border-radius:8px;">Walk up anytime</div>`;
    else status = `<div style="text-align:center;background:#EEF2F1;color:#6D7C83;font-weight:700;font-size:11.5px;padding:9px;border-radius:8px;">Full</div>`;
    return `
    <button data-act="openGame" data-id="${esc(g.id)}" style="text-align:left;background:${rowBg};border:1px solid ${rowBorder};border-radius:10px;padding:15px 16px;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
        <div style="min-width:0;">
          <div style="font-size:15.5px;font-weight:800;color:#00253D;line-height:1.2;">${esc(g.name)}</div>
          <div style="font-size:12px;color:#6D7C83;margin-top:3px;">${esc(g.runtimeLabel || '')}${g.venue ? ' · ' + esc(g.venue) : ''}${gm.hasSlots ? ' · ' + g.slots.length + ' slots' : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${bracketFor(g) ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#8A5A12;background:#FCEFDD;border:1px solid #F0D9BB;border-radius:5px;padding:2px 7px;">🏆 Bracket</span>` : ''}
          ${g.needsRef ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${dA};border:1px solid ${dA};border-radius:5px;padding:2px 7px;">Ref</span>` : ''}
        </div>
      </div>
      <div style="margin-top:13px;">${status}</div>
    </button>`;
  };

  const dq = (S.gameSearch || '').trim().toLowerCase();
  const deskVisible = (boot.games || []).filter(g =>
    !dq || (g.name + ' ' + (g.runtimeLabel || '') + ' ' + (g.venue || '')).toLowerCase().includes(dq));
  const searchBar = `
    <div style="display:flex;align-items:center;gap:10px;margin-top:18px;max-width:420px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);border-radius:9px;padding:11px 13px;">
      ${searchSvg('#8AA7B9')}
      <input id="gs-desk" data-live="gameSearch" value="${esc(S.gameSearch)}" placeholder="Search games, venues…" style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:#F3F7F5;font-size:14px;font-family:'Montserrat';"/>
      ${S.gameSearch ? `<button data-act="clearSearch" style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.14);color:#C7D3DB;font-size:13px;display:flex;align-items:center;justify-content:center;">×</button>` : ''}
    </div>`;
  const blocksHtml = deskVisible.length
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${deskVisible.map(mkCard).join('')}</div>`
    : `<div style="padding:40px 10px;text-align:center;font-size:14px;color:#6D7C83;">No games match “${esc(S.gameSearch)}”.</div>`;

  const mySignups = (boot.mySignups || []).slice().sort((a, b) => a.startMin - b.startMin).map(x => {
    const g = (boot.games || []).find(gg => gg.id === x.gameId);
    return { ...x, where: g ? g.venue : '' };
  });

  return `
  <div style="flex:1;display:flex;min-height:0;background:#F3F7F5;">
    <div class="scrl" style="flex:1;min-width:0;overflow-y:auto;background:#F3F7F5;">
      <div style="padding:30px 36px 22px;background:#00253D;position:relative;overflow:hidden;">
        <img src="/assets/logos/buffalo-white.png" alt="" style="position:absolute;right:-40px;top:-30px;width:260px;opacity:0.06;"/>
        <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${dA};">Sign up for games · August 14</div>
        <h1 style="font-family:'BN Kragen';font-size:40px;color:#F3F7F5;text-transform:uppercase;line-height:0.92;margin:9px 0 0;">The day's run of play</h1>
        <p style="font-size:14px;color:#C7D3DB;max-width:620px;line-height:1.55;margin:11px 0 0;">Browse every game by time block, see who's already in, and claim your spots. You can sign up for up to <strong style="color:#fff;">${signupMax()} games</strong> — as long as they don't overlap (walk-up games can overlap).</p>
        ${searchBar}
        ${isGameDay ? `
        <div style="display:inline-flex;align-items:center;gap:8px;margin-top:15px;background:rgba(255,95,0,0.16);border:1px solid ${dA};border-radius:8px;padding:9px 14px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${dA};"></span>
          <span style="font-size:12.5px;font-weight:700;color:#F3F7F5;">Game Day is live — sign-ups are locked.</span>
        </div>` : ''}
      </div>
      <div style="padding:26px 36px 40px;display:flex;flex-direction:column;gap:26px;">${blocksHtml}</div>
    </div>
    <div style="width:320px;flex-shrink:0;background:#fff;border-left:1px solid #E4EAE8;display:flex;flex-direction:column;">
      <div style="padding:24px 22px 18px;border-bottom:1px solid #EEF2F1;">
        <div style="font-family:'BN Kragen';font-size:20px;color:#00253D;text-transform:uppercase;">My games</div>
        <div style="font-size:12.5px;color:#6D7C83;margin-top:4px;">${mySignups.length} of ${signupMax()} spots claimed · ${Math.max(0, signupMax() - mySignups.length)} left</div>
      </div>
      <div class="scrl" style="flex:1;overflow-y:auto;padding:18px 22px;">
        ${mySignups.length ? `
        <div style="display:flex;flex-direction:column;gap:11px;">
          ${mySignups.map(m => `
          <div style="border:1px solid ${dA};background:${dDim};border-radius:10px;padding:14px;">
            <div style="font-size:14.5px;font-weight:800;color:#00253D;">${esc(m.game)}</div>
            <div style="font-size:12px;color:#6D7C83;margin-top:4px;">${esc(m.label)}${m.where ? ' · ' + esc(m.where) : ''}</div>
            ${!isGameDay ? `<button data-act="leaveSlot" data-slot="${m.slotId}" style="margin-top:11px;font-size:11.5px;font-weight:700;color:${dA};display:flex;align-items:center;gap:5px;">Cancel this spot</button>` : ''}
          </div>`).join('')}
        </div>` : `
        <div style="text-align:center;padding:30px 10px;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" style="margin:0 auto;"><rect x="4" y="5" width="16" height="16" rx="2" stroke="#C9D3D2" stroke-width="1.8"/><path d="M4 9h16M8 3v3M16 3v3M9 14l2 2 4-4" stroke="#C9D3D2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div style="font-size:13.5px;font-weight:700;color:#6D7C83;margin-top:12px;">No games claimed yet</div>
          <div style="font-size:12px;color:#9AA7A5;margin-top:4px;line-height:1.5;">Pick up to two games from the board. We'll flag anything that overlaps.</div>
        </div>`}
      </div>
      <div style="padding:16px 22px;border-top:1px solid #EEF2F1;background:#FAFCFB;">
        <div style="display:flex;align-items:center;gap:9px;">
          <span style="width:34px;height:34px;border-radius:8px;background:${T.deskChipBg};color:${T.deskChipFg};display:flex;align-items:center;justify-content:center;font-family:'BN Kragen';font-size:13px;">${esc(initials(myName))}</span>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:800;color:#00253D;">${esc(myName)}</div>
            <div style="font-size:11px;color:#6D7C83;">${esc(T.myTeamName)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ════════════════════ admin center ════════════════════ */
// Live venue timeline built from the REAL data — each game placed by its slot
// times under its venue lane, plus the admin-set schedule blocks in their own
// lane. No placeholder data; reflects exactly what's configured.
function timelineData(ov) {
  const parseE = (e) => parseTimeLabel(`${e.timeLabel || ''} ${e.ampm || ''}`);
  const GAME_LEN = 30;                      // ~30-min bar width per game
  const color = {
    game: { c: '#FF5F00', t: 'rgba(255,95,0,0.14)' },
    walk: { c: '#00253D', t: 'rgba(0,37,61,0.10)' },
    sched: { c: '#6B7A82', t: 'rgba(107,122,130,0.12)' },
  };
  const events = [];                        // { lane, name, a, b, kind }

  // Schedule blocks → a "Ceremonies & breaks" lane. Use the real end time when
  // set, otherwise span to the next block (capped) or a short default.
  const sched = (ov.schedule || []).map(e => ({
    name: e.title, a: parseE(e),
    endMin: parseTimeLabel(`${e.endLabel || ''} ${e.endAmpm || ''}`),
  })).filter(x => x.a != null).sort((x, y) => x.a - y.a);
  sched.forEach((s, i) => {
    const next = sched[i + 1];
    const b = (s.endMin != null && s.endMin > s.a) ? s.endMin
      : (next ? Math.min(next.a, s.a + 45) : s.a + 30);
    events.push({ lane: 'Ceremonies & breaks', name: s.name, a: s.a, b: Math.max(b, s.a + 15), kind: 'sched' });
  });

  // Each game → its venue lane, spanning first slot → last slot.
  for (const g of (ov.gamesCatalog || [])) {
    const slots = (g.slots || []).slice().sort((a, b) => a.startMin - b.startMin);
    if (!slots.length) continue;            // walk-up-only games have no fixed time to place
    events.push({
      lane: g.venue || 'Unassigned', name: g.name,
      a: slots[0].startMin, b: slots[slots.length - 1].startMin + GAME_LEN,
      kind: g.openPlay ? 'walk' : 'game',
    });
  }

  if (!events.length) return { lanes: [], hours: [], nowLeft: null, legend: [], empty: true };

  const T0 = Math.floor(Math.min(...events.map(e => e.a)) / 60) * 60;
  const T1 = Math.max(T0 + 60, Math.ceil(Math.max(...events.map(e => e.b)) / 60) * 60);
  const span = T1 - T0;
  const fmt = (m) => { let h = Math.floor(m / 60), mm = m % 60; let hh = h % 12; if (hh === 0) hh = 12; return hh + ':' + (mm < 10 ? '0' + mm : mm); };

  const laneNames = [];
  if (events.some(e => e.lane === 'Ceremonies & breaks')) laneNames.push('Ceremonies & breaks');
  laneNames.push(...[...new Set(events.filter(e => e.lane !== 'Ceremonies & breaks').map(e => e.lane))].sort());

  const lanes = laneNames.map(name => ({
    venue: name,
    items: events.filter(e => e.lane === name).sort((x, y) => x.a - y.a).map(e => ({
      name: e.name, time: fmt(e.a) + '–' + fmt(e.b),
      left: ((e.a - T0) / span * 100) + '%',
      width: (Math.max(e.b - e.a, 15) / span * 100) + '%',
      color: color[e.kind].c, bg: color[e.kind].t,
    })),
  }));
  const hours = [];
  for (let m = T0; m <= T1; m += 60) { let h = Math.floor(m / 60), hh = h % 12; if (hh === 0) hh = 12; hours.push({ label: hh + (h < 12 ? ' AM' : ' PM'), left: ((m - T0) / span * 100) + '%' }); }
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowLeft = (nowMin >= T0 && nowMin <= T1) ? (((nowMin - T0) / span) * 100) + '%' : null;
  const legend = [{ label: 'Games', c: color.game.c }, { label: 'Walk-up', c: color.walk.c }, { label: 'Ceremonies & breaks', c: color.sched.c }];
  return { lanes, hours, nowLeft, legend, empty: false };
}

// Canonical team colours + pill — the single source of truth for how we
// delineate Buffalo vs Texas Roadhouse people anywhere in the app:
//   Buffalo        → navy background, orange lettering
//   Texas Roadhouse→ red  background, yellow lettering
function teamColors(team) {
  if (team === 'buffalo') return { bg: '#00253D', fg: '#FF5F00', label: 'Buffalo' };
  if (team === 'roadhouse') return { bg: '#E0322E', fg: '#F5C518', label: 'Texas Roadhouse' };
  return { bg: '#EEF2F1', fg: '#6D7C83', label: 'No tribe' };
}
function teamPill(team, extraStyle) {
  const c = teamColors(team);
  return `<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${c.fg};background:${c.bg};border-radius:5px;padding:2px 7px;${extraStyle || ''}">${c.label}</span>`;
}
function admTeamChip(team) { return teamPill(team, 'margin-top:4px;'); }

// Small badge: shirt size (just the letter/short code, e.g. M / L / XL) and
// which Buff Olympics this is for the person (the `years` field, e.g. "3rd").
function admShirtBadge(size) {
  if (!size) return '';
  return `<span title="Shirt size" style="display:inline-flex;align-items:center;font-size:11px;font-weight:800;color:#00253D;background:#EEF2F1;border:1px solid #DCE3E2;border-radius:5px;padding:1px 6px;line-height:1.5;">${esc(size)}</span>`;
}
function admYearBadge(years) {
  if (!years) return '';
  return `<span title="Which Buff Olympics this is for them" style="display:inline-flex;align-items:center;font-size:11px;font-weight:700;color:#8A5A12;background:#FCEFDD;border:1px solid #F0D9BB;border-radius:5px;padding:1px 6px;line-height:1.5;">${esc(years)} 🏅</span>`;
}
function admPeopleSection(ov) {
  const rows = (ov.people || []).map(p => {
    const options = (ov.gamesCatalog || []).filter(g => !(p.games || []).some(x => x.gameId === g.id));
    // When a game is picked for this person, offer a time-slot chooser.
    let slotPick = '';
    if (S.admAddSlot && S.admAddSlot.uid === p.id) {
      const ag = (ov.gamesCatalog || []).find(x => x.id === S.admAddSlot.gameId);
      const asl = ag ? (ag.slots || []) : [];
      slotPick = asl.length
        ? `<select data-change="admAddGameSlot" data-uid="${p.id}" style="font-size:12px;font-weight:700;color:#00253D;background:#fff;border:1px solid #FF5F00;border-radius:6px;padding:5px 8px;cursor:pointer;">
             <option value="">${esc(ag.name)} — pick a time…</option>
             ${asl.map(s => `<option value="${s.id}">${esc(s.label)} · B ${s.nBuffalo}/${s.capBuffalo} · TXRH ${s.nRoadhouse}/${s.capRoadhouse}</option>`).join('')}
           </select>
           <button data-act="admAddCancel" style="font-size:11.5px;font-weight:700;color:#6D7C83;border:1px solid #DCE3E2;border-radius:6px;padding:5px 9px;">Cancel</button>`
        : `<span style="font-size:11.5px;color:#9AA7A5;font-style:italic;">${esc(ag ? ag.name : 'That game')} has no time slots.</span>
           <button data-act="admAddCancel" style="font-size:11.5px;font-weight:700;color:#6D7C83;border:1px solid #DCE3E2;border-radius:6px;padding:5px 9px;">Cancel</button>`;
    }
    return `
    <div style="display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid #EEF2F1;">
      <div style="width:172px;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;color:#00253D;">${esc(p.name)}</div>
        <div style="margin-top:3px;">${admTeamChip(p.team)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;">
          ${admShirtBadge(p.shirtSize)}
          ${admYearBadge(p.years)}
        </div>
      </div>
      <div style="flex:1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        ${(p.games || []).map(gm => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#00253D;background:#EEF2F1;border:1px solid #DCE3E2;border-radius:6px;padding:5px 8px;">${esc(gm.name)}<button data-act="admRemoveGame" data-uid="${p.id}" data-gid="${esc(gm.gameId)}" style="color:#C77B23;font-weight:800;font-size:14px;line-height:1;">×</button></span>`).join('')}
        ${(p.games || []).length === 0 ? '<span style="font-size:12px;color:#9AA7A5;font-style:italic;">No games yet</span>' : ''}
        <select data-change="admAddGame" data-uid="${p.id}" style="font-size:12px;font-weight:700;color:#FF5F00;background:#fff;border:1px dashed #FF5F00;border-radius:6px;padding:5px 8px;cursor:pointer;">
          <option value="">+ Add to game</option>
          ${options.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}
        </select>
        ${slotPick}
      </div>
      <div style="width:230px;flex-shrink:0;display:flex;gap:7px;">
        <button data-act="admToggle" data-uid="${p.id}" data-flag="toggleAdmin" style="font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:6px;background:${p.isAdmin ? '#00253D' : 'transparent'};color:${p.isAdmin ? '#F3F7F5' : '#6D7C83'};border:1px solid ${p.isAdmin ? '#00253D' : '#C9D3D2'};transition:all .15s;">${p.isAdmin ? 'Admin ✓' : 'Make admin'}</button>
        <button data-act="admToggle" data-uid="${p.id}" data-flag="toggleRef" style="font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:6px;background:${p.isRef ? '#FF5F00' : 'transparent'};color:${p.isRef ? '#011220' : '#6D7C83'};border:1px solid ${p.isRef ? '#FF5F00' : '#C9D3D2'};transition:all .15s;">${p.isRef ? 'Referee ✓' : 'Make ref'}</button>
      </div>
      <div style="width:96px;flex-shrink:0;display:flex;gap:6px;justify-content:flex-end;">
        <button data-act="admResetPw" data-uid="${p.id}" data-name="${esc(p.name)}" title="Reset password" style="width:32px;height:32px;border-radius:7px;border:1px solid #C9D3D2;color:#00253D;font-size:15px;display:flex;align-items:center;justify-content:center;">🔑</button>
        <button data-act="admRemoveUser" data-uid="${p.id}" data-name="${esc(p.name)}" title="Delete this person" style="width:32px;height:32px;border-radius:7px;border:1px solid #F0CDB3;color:#C77B23;font-size:15px;display:flex;align-items:center;justify-content:center;">🗑</button>
      </div>
    </div>`;
  }).join('');
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
    <div>
      <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">People</h3>
      <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Assign anyone to any game, set referees, grant admin, reset a password, or remove an account. Shirt size &amp; which Buff Olympics it is for them show under each name.</p>
    </div>
  </div>
  <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:14px;padding:11px 18px;background:#EEF2F1;border-bottom:1px solid #E0E6E5;font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;">
      <span style="width:172px;flex-shrink:0;">Name · shirt · year</span>
      <span style="flex:1;">Assigned games</span>
      <span style="width:230px;flex-shrink:0;">Roles</span>
      <span style="width:96px;flex-shrink:0;text-align:right;">Manage</span>
    </div>
    ${rows || '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No accounts yet.</div>'}
  </div>`;
}

// ── Songs (DJ) ──────────────────────────────────────────────────────────────
// Everyone's song request in one place, exportable as a CSV to hand to the DJ.
function admSongsSection(ov) {
  const withSongs = (ov.people || [])
    .filter(p => p.songRequest && p.songRequest.trim())
    .map(p => ({ name: p.name, team: p.team, song: p.songRequest.trim() }));
  const rows = withSongs.map(p => `
    <div style="display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid #EEF2F1;">
      <div style="width:180px;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;color:#00253D;">${esc(p.name)}</div>
        ${admTeamChip(p.team)}
      </div>
      <div style="flex:1;font-size:14px;color:#00253D;font-weight:600;">${esc(p.song)}</div>
    </div>`).join('');
  return `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
    <div>
      <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Songs</h3>
      <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Every song request players entered at sign-up — ${withSongs.length} so far. Export the list to hand to the DJ.</p>
    </div>
    <button data-act="admExportSongs" ${withSongs.length ? '' : 'disabled'} style="flex-shrink:0;background:${withSongs.length ? '#FF5F00' : '#C9D3D2'};color:${withSongs.length ? '#011220' : '#fff'};font-weight:800;font-size:13px;padding:11px 16px;border-radius:8px;${withSongs.length ? '' : 'cursor:not-allowed;'}">⬇ Export CSV for DJ</button>
  </div>
  <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:14px;padding:11px 18px;background:#EEF2F1;border-bottom:1px solid #E0E6E5;font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;">
      <span style="width:180px;flex-shrink:0;">Requested by</span>
      <span style="flex:1;">Song</span>
    </div>
    ${rows || '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No song requests yet.</div>'}
  </div>`;
}

// ── time helpers (admin slot editor) ──
// Accepts '1:30 PM', '1:30pm', '13:30' → minutes since midnight, or null.
function parseTimeLabel(str) {
  const s = String(str || '').trim();
  let m = s.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}
function minToLabel(min) {
  const m = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60), mm = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
}

function admGamesSection(ov) {
  const games = ov.gamesCatalog || [];
  const totalSlots = games.reduce((n, g) => n + (g.slots || []).length, 0);
  const people = ov.people || [];

  // "Fill slot" search panel — type a name, pick a match to drop into the slot.
  const fillPanel = (s) => {
    if (!S.admFillSlot || S.admFillSlot.slotId !== s.id) return '';
    const q = (S.f.admFillSearch || '').trim().toLowerCase();
    const matches = q ? people.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 6) : [];
    return `
    <div style="padding:10px 12px;border-top:1px solid #EEF2F1;background:#FCFBF7;">
      <div style="display:flex;align-items:center;gap:8px;">
        <input id="fill-search" data-live="admFill" value="${esc(S.f.admFillSearch || '')}" placeholder="Type a name to add…" style="flex:1;min-width:0;font-size:13px;color:#00253D;border:1px solid #DCE3E2;border-radius:7px;padding:8px 10px;outline:none;font-family:'Montserrat';"/>
        <button data-act="admFillCancel" style="flex-shrink:0;font-size:12px;font-weight:700;color:#6D7C83;border:1px solid #DCE3E2;border-radius:7px;padding:8px 11px;">Cancel</button>
      </div>
      ${matches.length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;">${matches.map(p => `
        <button data-act="admFillPick" data-slot="${s.id}" data-uid="${p.id}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1px solid #E0E6E5;border-radius:7px;padding:8px 11px;text-align:left;">
          <span style="font-size:13px;font-weight:700;color:#00253D;">${esc(p.name)}</span>
          ${admTeamChip(p.team)}
        </button>`).join('')}</div>` : (q ? '<div style="font-size:12px;color:#9AA7A5;margin-top:8px;font-style:italic;">No matches.</div>' : '<div style="font-size:11.5px;color:#9AA7A5;margin-top:7px;">Start typing a name…</div>')}
    </div>`;
  };

  const gameCard = (g) => {
    const slots = (g.slots || []).slice().sort((a, b) => a.startMin - b.startMin);
    const signed = slots.reduce((n, s) => n + (s.nBuffalo || 0) + (s.nRoadhouse || 0), 0);
    // Name chips per slot — tap the × to pull that person out of the slot
    // (admin override, reverse of + Fill).
    const rosterChips = (s) => {
      const ppl = s.people || [];
      if (!ppl.length) return '';
      return `<div style="display:flex;flex-wrap:wrap;gap:5px;padding:0 12px 9px 96px;">${ppl.map(p => `
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:${p.team === 'roadhouse' ? '#B3241F' : '#B34700'};background:${p.team === 'roadhouse' ? '#FDEEEE' : '#FFF3E8'};border:1px solid ${p.team === 'roadhouse' ? '#F2CFCE' : '#F5DCC4'};border-radius:6px;padding:4px 5px 4px 9px;">${esc(p.name)}
          <button data-act="admUnfill" data-slot="${s.id}" data-uid="${p.id}" data-name="${esc(p.name)}" data-label="${esc(s.label)}" title="Remove from this slot" style="width:16px;height:16px;border-radius:4px;background:rgba(0,0,0,0.06);color:inherit;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center;">×</button>
        </span>`).join('')}</div>`;
    };
    const slotRows = slots.length ? slots.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid #EEF2F1;">
        <span style="width:74px;flex-shrink:0;font-family:'BN Kragen';font-size:14px;color:#00253D;">${esc(s.label)}</span>
        <div style="flex:1;min-width:0;display:flex;gap:12px;">
          <span style="font-size:12px;font-weight:700;color:#FF5F00;">Buffalo ${s.nBuffalo}/${s.capBuffalo}</span>
          <span style="font-size:12px;font-weight:700;color:#E0322E;">TXRH ${s.nRoadhouse}/${s.capRoadhouse}</span>
        </div>
        <button data-act="admFillOpen" data-slot="${s.id}" data-game="${esc(g.id)}" style="flex-shrink:0;font-size:11px;font-weight:700;color:#1F8A5B;border:1px solid #BFE3D0;border-radius:6px;padding:6px 10px;">+ Fill</button>
        <button data-act="admSlotEdit" data-game="${esc(g.id)}" data-slot="${s.id}" style="flex-shrink:0;font-size:11px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:6px;padding:6px 10px;">Edit</button>
        <button data-act="admSlotDelete" data-slot="${s.id}" data-signed="${(s.nBuffalo || 0) + (s.nRoadhouse || 0)}" data-label="${esc(s.label)}" style="flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid #F0CDB3;color:#C77B23;font-size:15px;display:flex;align-items:center;justify-content:center;">×</button>
      </div>${rosterChips(s)}${fillPanel(s)}`).join('') : `<div style="padding:11px 12px;border-top:1px solid #EEF2F1;font-size:12px;color:#9AA7A5;font-style:italic;">No time slots yet${g.openPlay ? ' — pure walk-up.' : '.'}</div>`;
    return `
    <div style="background:#fff;border:1px solid #E0E6E5;border-left:3px solid ${g.openPlay ? '#00253D' : '#FF5F00'};border-radius:10px;overflow:hidden;">
      <div style="padding:13px 15px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;">${esc(g.runtimeLabel || 'No time set')}</span>
            ${g.openPlay ? '<span style="font-size:9px;font-weight:800;color:#fff;background:#00253D;border-radius:4px;padding:2px 6px;">Walk-up</span>' : ''}
            ${g.needsRef ? '<span style="font-size:9px;font-weight:800;color:#fff;background:#FF5F00;border-radius:4px;padding:2px 6px;">Ref</span>' : ''}
            ${g.headToHead ? '<span style="font-size:9px;font-weight:800;color:#fff;background:#1F8A5B;border-radius:4px;padding:2px 6px;">Head-to-Head</span>' : ''}
            ${g.isBracket ? '<span style="font-size:9px;font-weight:800;color:#8A5A12;background:#FCEFDD;border:1px solid #F0D9BB;border-radius:4px;padding:2px 6px;">🏆 Bracket</span>' : ''}
          </div>
          <div style="font-family:'BN Kragen';font-size:18px;color:#00253D;text-transform:uppercase;line-height:1;margin-top:5px;">${esc(g.name)}</div>
          <div style="font-size:11.5px;color:#6D7C83;margin-top:5px;">${slots.length} slot${slots.length === 1 ? '' : 's'} · ${signed} signed up${g.venue ? ' · ' + esc(g.venue) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button data-act="admBracketOpen" data-id="${esc(g.id)}" style="font-size:11.5px;font-weight:700;color:#8A5A12;border:1px solid #F0D9BB;background:#FCEFDD;border-radius:6px;padding:7px 11px;">🏆 Bracket</button>
          <button data-act="admGameEdit" data-id="${esc(g.id)}" style="font-size:11.5px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:6px;padding:7px 11px;">Edit</button>
          <button data-act="admGameDelete" data-id="${esc(g.id)}" data-name="${esc(g.name)}" data-signed="${signed}" style="width:30px;height:30px;border-radius:6px;border:1px solid #F0CDB3;color:#C77B23;font-size:16px;display:flex;align-items:center;justify-content:center;">×</button>
        </div>
      </div>
      ${slotRows}
      <button data-act="admSlotNew" data-game="${esc(g.id)}" style="width:100%;padding:9px;border-top:1px solid #EEF2F1;font-size:12px;font-weight:700;color:#FF5F00;background:#FCFBF7;">+ Add time slot</button>
    </div>`;
  };

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;">
    <div>
      <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Games &amp; slots</h3>
      <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">${games.length} games · ${totalSlots} slots. Edit times or caps freely — sign-ups are preserved. Deleting a slot or game only drops that item's sign-ups.</p>
    </div>
    <button data-act="admGameNew" style="background:#FF5F00;color:#011220;font-weight:800;font-size:13px;padding:11px 16px;border-radius:8px;flex-shrink:0;">+ Add game</button>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;">${games.map(gameCard).join('')}</div>`;
}

// ── admin game/slot modals ──
function admModalShell(title, inner, saveAct, cancelAct) {
  return `
  <div data-act="${cancelAct}" style="position:fixed;inset:0;background:rgba(1,18,31,0.55);z-index:1400;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div data-act="admNoop" style="background:#fff;border-radius:14px;width:100%;max-width:420px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,0.4);">
      <div style="padding:16px 18px;border-bottom:1px solid #EEF2F1;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-family:'BN Kragen';font-size:19px;color:#00253D;text-transform:uppercase;">${esc(title)}</span>
        <button data-act="${cancelAct}" style="width:28px;height:28px;border-radius:7px;background:#EEF2F1;color:#46545B;font-size:15px;">×</button>
      </div>
      <div style="padding:18px;overflow-y:auto;">${inner}</div>
      <div style="padding:14px 18px;border-top:1px solid #EEF2F1;display:flex;gap:10px;justify-content:flex-end;flex-shrink:0;">
        <button data-act="${cancelAct}" style="font-size:13px;font-weight:700;color:#46545B;padding:11px 16px;border-radius:8px;border:1px solid #DCE3E2;">Cancel</button>
        <button data-act="${saveAct}" style="background:#FF5F00;color:#011220;font-weight:800;font-size:13px;padding:11px 20px;border-radius:8px;">Save</button>
      </div>
    </div>
  </div>`;
}
function admFieldLabel(t) {
  return `<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6D7C83;margin-bottom:6px;">${t}</div>`;
}
function admTextInput(id, field, val, ph) {
  return `<input id="${id}" data-field="${field}" value="${esc(val)}" placeholder="${esc(ph || '')}" style="width:100%;font-size:14px;color:#00253D;border:1px solid #DCE3E2;border-radius:8px;padding:11px 12px;font-family:'Montserrat';outline:none;"/>`;
}
function admToggle(label, on, act) {
  return `<button data-act="${act}" style="display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;color:#00253D;">
    <span style="width:40px;height:23px;border-radius:12px;background:${on ? '#FF5F00' : '#D6DEDC'};position:relative;transition:background .15s;flex-shrink:0;"><span style="position:absolute;top:2px;left:${on ? '19px' : '2px'};width:19px;height:19px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span></span>${label}</button>`;
}
function admGamesModals() {
  let html = '';
  const ge = S.admGameEdit;
  if (ge) {
    const inner = `
      ${admFieldLabel('Game name')}
      ${admTextInput('gm-name', 'gmName', S.f.gmName || '', 'e.g. Tug of War')}
      <div style="height:14px;"></div>
      ${admFieldLabel('Time window (label only)')}
      ${admTextInput('gm-time', 'gmTime', S.f.gmTime || '', 'e.g. 2:00 PM – 2:30 PM')}
      <div style="height:14px;"></div>
      ${admFieldLabel('Venue (optional)')}
      ${admTextInput('gm-venue', 'gmVenue', S.f.gmVenue || '', 'e.g. The Lawn')}
      <div style="height:14px;"></div>
      ${admFieldLabel('Players pill (shown on the game)')}
      ${admTextInput('gm-players', 'gmPlayers', S.f.gmPlayers || '', 'e.g. 1 player from each team per heat, 6 total')}
      <div style="font-size:11px;color:#9AA7A5;margin-top:5px;">Free text — make the count match the sign-up slots.</div>
      <div style="height:14px;"></div>
      ${admFieldLabel('Points pill (shown on the game)')}
      ${admTextInput('gm-ptslabel', 'gmPointsLabel', S.f.gmPointsLabel || '', 'e.g. 10 points to first across the line')}
      <div style="height:14px;"></div>
      ${admFieldLabel('Points for a win')}
      ${admTextInput('gm-points', 'gmPoints', S.f.gmPoints || '', 'e.g. 10')}
      <div style="font-size:11px;color:#9AA7A5;margin-top:5px;">The number awarded to the winning tribe when a ref logs a head-to-head / championship winner.</div>
      <div style="height:14px;"></div>
      ${admFieldLabel('Team size (players per team)')}
      ${admTextInput('gm-teamsize', 'gmTeamSize', S.f.gmTeamSize || '', 'e.g. 1 for singles, 2 for pairs')}
      <div style="font-size:11px;color:#9AA7A5;margin-top:5px;">1 = individuals (default). 2+ = teams — each timeslot then holds Team 1 / Team 2 sign-ups per tribe (players pick a teammate) and the ref scores each team. Set a slot's caps to <strong>teams × team size</strong>.</div>
      <div style="height:14px;"></div>
      ${admFieldLabel('How to play')}
      <textarea id="gm-descr" data-field="gmDescr" placeholder="Explain how the game is played…" style="width:100%;min-height:84px;font-size:14px;color:#00253D;border:1px solid #DCE3E2;border-radius:8px;padding:11px 12px;font-family:'Montserrat';outline:none;resize:vertical;">${esc(S.f.gmDescr || '')}</textarea>
      <div style="height:14px;"></div>
      ${admFieldLabel('Video link — “See how it’s played” (optional)')}
      ${admTextInput('gm-video', 'gmVideo', S.f.gmVideo || '', 'YouTube URL')}
      <div style="font-size:11px;color:#9AA7A5;margin-top:5px;">Paste a YouTube link; a “See how it's played” button shows on the game.</div>
      <div style="height:16px;"></div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${admToggle('Needs a referee', ge.needsRef, 'admGameFlagRef')}
        ${admToggle('Walk-up game (open after its window)', ge.openPlay, 'admGameFlagWalk')}
        ${admToggle('Head-to-head (ref picks a winning tribe)', ge.headToHead, 'admGameFlagH2H')}
      </div>
      <div style="font-size:11px;color:#9AA7A5;margin-top:8px;line-height:1.5;">Head-to-head ON → the ref picks the winning tribe and it earns the flat “Points for a win”. OFF → the ref types any number of points for each player (variable scoring, no single winner).</div>`;
    html += admModalShell(ge.mode === 'add' ? 'Add game' : 'Edit game', inner, 'admGameSave', 'admGameCancel');
  }
  const se = S.admSlotEdit;
  if (se) {
    const sg = ((S.overview || {}).gamesCatalog || []).find(x => x.id === se.gameId) || {};
    const sts = (sg.teamSize && sg.teamSize >= 2) ? sg.teamSize : 1;
    const capsBlock = sts >= 2 ? `
      <div style="display:flex;gap:12px;">
        <div style="flex:1;">${admFieldLabel('# Buffalo teams')}${admTextInput('sl-tb', 'slTeamsB', S.f.slTeamsB || '', '0')}</div>
        <div style="flex:1;">${admFieldLabel('# TXRH teams')}${admTextInput('sl-tr', 'slTeamsR', S.f.slTeamsR || '', '0')}</div>
      </div>
      <div style="font-size:11px;color:#9AA7A5;margin-top:8px;line-height:1.5;">${esc(sg.name || 'This game')} plays in teams of <strong>${sts}</strong>. Each tribe's cap = (# teams) × ${sts}, so players sign up as Team 1 / Team 2. 0 teams = that tribe isn't in this slot.</div>`
      : `
      <div style="display:flex;gap:12px;">
        <div style="flex:1;">${admFieldLabel('Buffalo cap')}${admTextInput('sl-cb', 'slCapB', S.f.slCapB || '', '0')}</div>
        <div style="flex:1;">${admFieldLabel('TXRH cap')}${admTextInput('sl-cr', 'slCapR', S.f.slCapR || '', '0')}</div>
      </div>
      <div style="font-size:11px;color:#9AA7A5;margin-top:8px;">0 for a tribe means that tribe isn't in this slot.</div>`;
    const inner = `
      ${admFieldLabel('Time')}
      ${admTextInput('sl-time', 'slTime', S.f.slTime || '', 'e.g. 1:30 PM')}
      <div style="font-size:11px;color:#9AA7A5;margin-top:5px;">Type it like “1:30 PM”. This sets both the label and the sort order.</div>
      <div style="height:14px;"></div>
      ${capsBlock}`;
    html += admModalShell(se.mode === 'add' ? 'Add time slot' : 'Edit time slot', inner, 'admSlotSave', 'admSlotCancel');
  }
  if (S.admBracketEdit) html += admBracketModal();
  return html;
}

// ── Bracket Builder (migration 012) — the MATCH structure refs score ──
// Each match is a bo_game_slots row with round_no + lane. Round 1 matches take
// sign-ups (caps = 2 teams × team size for that tribe); later rounds and the
// championship are cap-0 slots that auto-fill with the previous round's winners.
function admBracketBuilder(g) {
  const ts = (g.teamSize && g.teamSize >= 2) ? g.teamSize : 1;
  const slots = (g.slots || []).slice().sort((a, b) =>
    ((a.roundNo ?? 99) - (b.roundNo ?? 99)) || (a.startMin - b.startMin) || (a.id - b.id));
  const laneOpt = [
    { k: 'buffalo', label: 'Buffalo', c: '#FF5F00' },
    { k: 'roadhouse', label: 'TXRH', c: '#E0322E' },
    { k: 'final', label: '🏆 Championship', c: '#C79A1E' },
  ];
  const laneBadge = (lane) => {
    if (lane === 'final') return `<span style="font-size:9.5px;font-weight:800;color:#fff;background:#C79A1E;border-radius:4px;padding:2px 7px;">🏆 FINAL</span>`;
    if (lane === 'buffalo') return `<span style="font-size:9.5px;font-weight:800;color:#fff;background:#FF5F00;border-radius:4px;padding:2px 7px;">BUFFALO</span>`;
    if (lane === 'roadhouse') return `<span style="font-size:9.5px;font-weight:800;color:#fff;background:#E0322E;border-radius:4px;padding:2px 7px;">TXRH</span>`;
    return `<span style="font-size:9.5px;font-weight:800;color:#46545B;background:#EEF2F1;border-radius:4px;padding:2px 7px;">BOTH</span>`;
  };
  const row = (s) => {
    if (S.admMatchEdit === s.id) {
      const laneBtn = (o) => `<button data-act="admMatchLanePick" data-lane="${o.k}" style="flex:1;padding:7px 4px;border-radius:6px;font-size:10.5px;font-weight:700;background:${S.f.bmLane === o.k ? o.c : '#fff'};color:${S.f.bmLane === o.k ? '#fff' : '#46545B'};border:1px solid ${S.f.bmLane === o.k ? o.c : '#DCE3E2'};">${o.label}</button>`;
      return `
      <div style="padding:12px 13px;border:1px solid #FFD3B5;border-radius:9px;background:#FFF9F4;margin-bottom:8px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <div style="width:120px;">${admFieldLabel('Time')}${admTextInput('bm-time', 'bmTime', S.f.bmTime || '', 'e.g. 2:30 PM')}</div>
          <div style="width:80px;">${admFieldLabel('Round #')}${admTextInput('bm-round', 'bmRound', S.f.bmRound || '', '1')}</div>
        </div>
        <div style="margin-top:10px;">${admFieldLabel('Whose match?')}<div style="display:flex;gap:6px;">${laneOpt.map(laneBtn).join('')}</div></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button data-act="admMatchSave" data-slot="${s.id}" style="background:#FF5F00;color:#011220;font-weight:800;font-size:12.5px;padding:9px 15px;border-radius:8px;">Save match</button>
          <button data-act="admMatchCancel" style="color:#6D7C83;font-weight:700;font-size:12.5px;padding:9px 12px;border-radius:8px;border:1px solid #DCE3E2;">Cancel</button>
        </div>
      </div>`;
    }
    const seats = (s.capBuffalo || 0) + (s.capRoadhouse || 0);
    const detail = seats > 0
      ? `sign-ups · B ${s.nBuffalo}/${s.capBuffalo} · TXRH ${s.nRoadhouse}/${s.capRoadhouse}`
      : 'auto-fills with the previous round’s winners';
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #E0E6E5;border-radius:9px;margin-bottom:7px;">
      <span style="width:74px;flex-shrink:0;font-family:'BN Kragen';font-size:14px;color:#C77B23;">${esc(s.label)}</span>
      ${laneBadge(s.lane || null)}
      <span style="flex:1;min-width:0;font-size:11px;color:#6D7C83;">${detail}</span>
      <button data-act="admMatchEditStart" data-slot="${s.id}" data-time="${esc(s.label)}" data-round="${s.roundNo ?? ''}" data-lane="${esc(s.lane || '')}" style="flex-shrink:0;font-size:11px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:6px;padding:6px 10px;">Edit</button>
      <button data-act="admMatchRemove" data-slot="${s.id}" data-signed="${(s.nBuffalo || 0) + (s.nRoadhouse || 0)}" style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:1px solid #F0CDB3;color:#C77B23;font-size:14px;">×</button>
    </div>`;
  };
  // Group by round for display.
  const groups = [];
  for (const s of slots) {
    const label = s.roundNo == null ? 'Unassigned sign-up slots' : (s.lane === 'final' ? `Round ${s.roundNo} · Championship` : `Round ${s.roundNo}`);
    let grp = groups.find(x => x.label === label);
    if (!grp) { grp = { label, roundNo: s.roundNo, rows: [] }; groups.push(grp); }
    grp.rows.push(row(s));
  }
  const maxRound = Math.max(0, ...slots.map(s => s.roundNo || 0));
  const addBtn = (label, round, lane) =>
    `<button data-act="admMatchAdd" data-game="${esc(g.id)}" data-round="${round}" data-lane="${lane}" style="font-size:11.5px;font-weight:700;color:#FF5F00;border:1px dashed #FF5F00;border-radius:7px;padding:7px 11px;background:#FCFBF7;">${label}</button>`;
  const groupHtml = groups.map(gp => `
    <div style="display:flex;align-items:center;gap:8px;margin:12px 0 7px;">
      <span style="font-size:10.5px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#6D7C83;">${esc(gp.label)}</span>
      ${gp.roundNo != null && !gp.label.includes('Championship') ? `<span style="flex:1;"></span>${addBtn('+ Buffalo', gp.roundNo, 'buffalo')}${addBtn('+ TXRH', gp.roundNo, 'roadhouse')}` : ''}
    </div>
    ${gp.rows.join('')}`).join('');
  const hasFinal = slots.some(s => s.lane === 'final');
  return `
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6D7C83;margin-bottom:4px;">Bracket matches (what refs score)</div>
    <div style="font-size:11px;color:#9AA7A5;line-height:1.5;margin-bottom:4px;">Every time slot below is one match. <strong>Round 1</strong> matches take sign-ups${ts >= 2 ? ` (teams of ${ts})` : ''}; later rounds and the championship fill in automatically as refs log winners. Two same-time matches (one per tribe) are separate rows.</div>
    ${groupHtml || '<div style="font-size:12px;color:#9AA7A5;font-style:italic;margin:8px 0;">No time slots yet — add Round 1 matches below.</div>'}
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin:10px 0 16px;">
      ${maxRound === 0 ? addBtn('+ Round 1 Buffalo match', 1, 'buffalo') + addBtn('+ Round 1 TXRH match', 1, 'roadhouse') : ''}
      ${maxRound > 0 ? addBtn(`+ Round ${maxRound + 1} Buffalo`, maxRound + 1, 'buffalo') + addBtn(`+ Round ${maxRound + 1} TXRH`, maxRound + 1, 'roadhouse') : ''}
      ${!hasFinal && maxRound > 0 ? addBtn('+ Championship', maxRound + 1, 'final') : ''}
    </div>`;
}

// Fully-editable bracket editor (migration 009). Toggle whether a game is a
// bracket, edit its intro, and add / edit / remove rounds — this is also how you
// "see the bracket" from the Admin Center.
function admBracketModal() {
  const be = S.admBracketEdit;
  const g = ((S.overview || {}).gamesCatalog || []).find(x => x.id === be.gameId);
  if (!g) return '';
  const rounds = g.bracketRounds || [];
  const teamOpt = [
    { k: 'buffalo', label: 'Buffalo', c: '#FF5F00' },
    { k: 'roadhouse', label: 'Texas Roadhouse', c: '#E0322E' },
    { k: 'both', label: 'Both tribes', c: '#6D7C83' },
    { k: 'final', label: 'Championship', c: '#C79A1E' },
  ];
  const teamBadge = (t) => {
    const o = teamOpt.find(x => x.k === t) || teamOpt[2];
    return `<span style="font-size:9.5px;font-weight:800;text-transform:uppercase;color:#fff;background:${o.c};border-radius:4px;padding:2px 7px;">${o.label}</span>`;
  };
  const roundRow = (r) => {
    if (S.admRoundEdit === r.id) {
      const teamBtn = (o) => `<button data-act="admRoundTeamPick" data-team="${o.k}" style="flex:1;padding:7px 4px;border-radius:6px;font-size:11px;font-weight:700;background:${S.admRoundTeam === o.k ? o.c : '#fff'};color:${S.admRoundTeam === o.k ? '#fff' : '#46545B'};border:1px solid ${S.admRoundTeam === o.k ? o.c : '#DCE3E2'};">${o.label}</button>`;
      return `
      <div style="padding:12px 13px;border:1px solid #FFD3B5;border-radius:9px;background:#FFF9F4;margin-bottom:8px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <div style="width:130px;">${admFieldLabel('Time')}${admTextInput('br-time', 'brTime', S.f.brTime || '', 'e.g. 3:00 PM')}</div>
          <div style="flex:1;min-width:130px;">${admFieldLabel('Round name')}${admTextInput('br-name', 'brName', S.f.brName || '', 'e.g. Championship')}</div>
        </div>
        <div style="margin-top:10px;">${admFieldLabel('Detail')}${admTextInput('br-detail', 'brDetail', S.f.brDetail || '', 'e.g. Buffalo winner vs Texas Roadhouse winner')}</div>
        <div style="margin-top:10px;">${admFieldLabel('Matchup')}<div style="display:flex;gap:6px;">${teamOpt.map(teamBtn).join('')}</div></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button data-act="admRoundSave" data-round="${r.id}" style="background:#FF5F00;color:#011220;font-weight:800;font-size:12.5px;padding:9px 15px;border-radius:8px;">Save round</button>
          <button data-act="admRoundCancel" style="color:#6D7C83;font-weight:700;font-size:12.5px;padding:9px 12px;border-radius:8px;border:1px solid #DCE3E2;">Cancel</button>
        </div>
      </div>`;
    }
    return `
    <div style="display:flex;align-items:center;gap:11px;padding:11px 13px;border:1px solid #E0E6E5;border-radius:9px;margin-bottom:8px;">
      <span style="width:88px;flex-shrink:0;font-family:'BN Kragen';font-size:14px;color:#C77B23;line-height:1.1;">${esc(r.time || '—')}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;"><span style="font-size:13.5px;font-weight:700;color:#00253D;">${esc(r.name || 'Untitled round')}</span>${teamBadge(r.team)}</div>
        ${r.detail ? `<div style="font-size:11.5px;color:#6D7C83;margin-top:2px;">${esc(r.detail)}</div>` : ''}
      </div>
      <button data-act="admRoundEditStart" data-round="${r.id}" data-time="${esc(r.time || '')}" data-name="${esc(r.name || '')}" data-detail="${esc(r.detail || '')}" data-team="${esc(r.team || 'both')}" style="flex-shrink:0;font-size:11.5px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:6px;padding:6px 10px;">Edit</button>
      <button data-act="admRoundRemove" data-round="${r.id}" style="flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid #F0CDB3;color:#C77B23;font-size:15px;">×</button>
    </div>`;
  };
  const inner = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#F6F8F7;border:1px solid #E6ECEA;border-radius:9px;padding:11px 13px;">
      <span style="font-size:13px;font-weight:700;color:#00253D;">Show this game as a bracket</span>
      ${admToggle('', g.isBracket, 'admBracketToggle')}
    </div>
    <div style="font-size:11px;color:#9AA7A5;margin:8px 0 16px;line-height:1.5;">When ON, players and refs see a 🏆 Bracket pill and the rounds below as the game's "Bracket path."</div>
    <div style="display:flex;gap:12px;align-items:flex-end;background:#F6F8F7;border:1px solid #E6ECEA;border-radius:9px;padding:12px 13px;margin-bottom:8px;">
      <div style="width:150px;">${admFieldLabel('Points per round win')}${admTextInput('br-roundpts', 'brRoundPts', S.f.brRoundPts !== undefined ? S.f.brRoundPts : String(g.roundPoints || 0), 'e.g. 10')}</div>
      <button data-act="admBracketPointsSave" style="font-size:12px;font-weight:700;color:#FF5F00;border:1px solid #FFD3B5;border-radius:7px;padding:9px 13px;margin-bottom:1px;">Save points</button>
    </div>
    <div style="font-size:11px;color:#9AA7A5;margin:0 0 16px;line-height:1.5;">Each within-tribe round win awards these points to the winner's tribe (0 = advancement only). The overall champion earns the game's "Points for a win" — currently <strong>${g.winPoints != null ? g.winPoints : 10}</strong>, set in the game editor.</div>
    ${admBracketBuilder(g)}
    ${admFieldLabel('Intro blurb (optional)')}
    <textarea id="br-intro" data-field="brIntro" placeholder="One line explaining how the bracket works…" style="width:100%;min-height:64px;font-size:13.5px;color:#00253D;border:1px solid #DCE3E2;border-radius:8px;padding:10px 11px;font-family:'Montserrat';outline:none;resize:vertical;">${esc(S.f.brIntro !== undefined ? S.f.brIntro : (g.bracketIntro || ''))}</textarea>
    <div style="margin-top:8px;"><button data-act="admBracketIntroSave" style="font-size:12px;font-weight:700;color:#FF5F00;border:1px solid #FFD3B5;border-radius:7px;padding:8px 13px;">Save intro</button></div>
    <div style="height:1px;background:#EEF2F1;margin:18px 0 14px;"></div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6D7C83;margin-bottom:10px;">Bracket path (shown to players)</div>
    ${rounds.length ? rounds.map(roundRow).join('') : '<div style="font-size:12.5px;color:#9AA7A5;font-style:italic;margin-bottom:8px;">No rounds yet.</div>'}
    <button data-act="admRoundAdd" data-game="${esc(g.id)}" style="width:100%;padding:10px;border:1px dashed #FF5F00;border-radius:8px;font-size:12.5px;font-weight:700;color:#FF5F00;background:#FCFBF7;">+ Add round</button>`;
  return `
  <div data-act="admBracketClose" style="position:fixed;inset:0;background:rgba(1,18,31,0.55);z-index:1400;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div data-act="admNoop" style="background:#fff;border-radius:14px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;box-shadow:0 30px 70px rgba(0,0,0,0.4);">
      <div style="padding:16px 18px;border-bottom:1px solid #EEF2F1;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;">
        <span style="font-family:'BN Kragen';font-size:19px;color:#00253D;text-transform:uppercase;">🏆 Bracket — ${esc(g.name)}</span>
        <button data-act="admBracketClose" style="width:28px;height:28px;border-radius:7px;background:#EEF2F1;color:#46545B;font-size:15px;">×</button>
      </div>
      <div style="padding:18px;">${inner}</div>
    </div>
  </div>`;
}

function admScheduleSection(ov) {
  const isList = S.schedView !== 'timeline';
  let body = '';
  if (isList) {
    const kindBtn = (k, label) => `<button data-act="admSchedKind" data-kind="${k}" style="flex:1;padding:8px;border-radius:6px;font-size:12px;font-weight:700;background:${S.admSchedKind === k ? '#00253D' : '#fff'};color:${S.admSchedKind === k ? '#fff' : '#46545B'};border:1px solid #DCE3E2;transition:all .15s;">${label}</button>`;
    const rowHtml = (e) => {
      if (S.admSchedEdit === e.id) {
        return `
        <div style="padding:16px 18px;border-bottom:1px solid #EEF2F1;background:#FAFCFB;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div style="width:135px;">${admFieldLabel('Start time')}${admTextInput('sch-time', 'schTime', S.f.schTime || '', 'e.g. 8:00 AM')}</div>
            <div style="width:135px;">${admFieldLabel('End time (optional)')}${admTextInput('sch-end', 'schEnd', S.f.schEnd || '', 'e.g. 9:00 AM')}</div>
            <div style="flex:1;min-width:160px;">${admFieldLabel('Title')}${admTextInput('sch-title', 'schTitle', S.f.schTitle || '', 'Opening Ceremony')}</div>
            <div style="flex:1;min-width:160px;">${admFieldLabel('Place')}${admTextInput('sch-place', 'schPlace', S.f.schPlace || '', 'Main Lawn')}</div>
          </div>
          <div style="margin-top:12px;max-width:340px;">${admFieldLabel('Status')}
            <div style="display:flex;gap:6px;">${kindBtn('up', 'Upcoming')}${kindBtn('live', 'Live now')}${kindBtn('done', 'Done')}</div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;">
            <button data-act="admSchedSave" data-id="${e.id}" style="background:#FF5F00;color:#011220;font-weight:800;font-size:13px;padding:10px 16px;border-radius:8px;">Save</button>
            <button data-act="admSchedCancel" style="color:#6D7C83;font-weight:700;font-size:13px;padding:10px 12px;border-radius:8px;border:1px solid #DCE3E2;">Cancel</button>
          </div>
        </div>`;
      }
      return `
      <div style="display:flex;align-items:center;gap:16px;padding:13px 18px;border-bottom:1px solid #EEF2F1;">
        <span style="width:100px;flex-shrink:0;font-family:'BN Kragen';font-size:15px;color:#FF5F00;line-height:1.15;">${esc(e.timeLabel)} ${esc(e.ampm)}${e.endLabel ? `<span style="font-size:11px;color:#9AA7A5;"> – ${esc(e.endLabel)} ${esc(e.endAmpm)}</span>` : ''}</span>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:14px;font-weight:700;color:#00253D;">${esc(e.title)}</span>
            ${e.kind === 'live' ? '<span style="font-size:9px;font-weight:800;color:#011220;background:#FF5F00;border-radius:4px;padding:2px 6px;">LIVE</span>' : ''}
            ${e.kind === 'done' ? '<span style="font-size:9px;font-weight:800;color:#6D7C83;background:#EEF2F1;border-radius:4px;padding:2px 6px;">DONE</span>' : ''}
          </div>
          <div style="font-size:12px;color:#6D7C83;margin-top:2px;">${esc(e.place)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button data-act="admSchedEdit" data-id="${e.id}" style="height:30px;padding:0 11px;border-radius:6px;border:1px solid #DCE3E2;color:#00253D;font-size:12px;font-weight:700;">Edit</button>
          <button data-act="admSchedMove" data-id="${e.id}" data-dir="-1" style="width:30px;height:30px;border-radius:6px;border:1px solid #DCE3E2;color:#00253D;display:flex;align-items:center;justify-content:center;font-size:13px;">↑</button>
          <button data-act="admSchedMove" data-id="${e.id}" data-dir="1" style="width:30px;height:30px;border-radius:6px;border:1px solid #DCE3E2;color:#00253D;display:flex;align-items:center;justify-content:center;font-size:13px;">↓</button>
          <button data-act="admSchedRemove" data-id="${e.id}" style="width:30px;height:30px;border-radius:6px;border:1px solid #F0CDB3;color:#C77B23;display:flex;align-items:center;justify-content:center;font-size:16px;">×</button>
        </div>
      </div>`;
    };
    body = `
    <p style="font-size:13px;color:#6D7C83;margin:0 0 12px;">These blocks show on <strong>everyone's</strong> schedule — the whole-event moments (ceremonies, lunch, reveals). Each player's own game slots fill in around them automatically.</p>
    <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
      ${(ov.schedule || []).map(rowHtml).join('') || '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No schedule blocks yet — add one below.</div>'}
    </div>`;
  } else {
    const tl = timelineData(ov);
    body = tl.empty ? `
    <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;padding:28px;text-align:center;font-size:13.5px;color:#6D7C83;">
      Nothing to plot yet — the timeline fills in from your games' time slots and schedule blocks. Add a slot or a block and it shows up here.
    </div>` : `
    <div style="display:flex;flex-wrap:wrap;gap:13px 18px;margin-bottom:14px;">
      ${tl.legend.map(lg => `<span style="display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:600;color:#46545B;"><span style="width:11px;height:11px;border-radius:3px;background:${lg.c};"></span>${lg.label}</span>`).join('')}
    </div>
    <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;display:flex;">
      <div style="width:138px;flex-shrink:0;border-right:1px solid #E0E6E5;">
        <div style="height:32px;border-bottom:1px solid #EEF2F1;"></div>
        ${tl.lanes.map(ln => `<div style="height:60px;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid #EEF2F1;font-size:12.5px;font-weight:700;color:#00253D;line-height:1.1;">${esc(ln.venue)}</div>`).join('')}
      </div>
      <div class="scrl" style="flex:1;overflow-x:auto;">
        <div style="position:relative;min-width:760px;">
          <div style="position:relative;height:32px;border-bottom:1px solid #EEF2F1;">
            ${tl.hours.map(hr => `<span style="position:absolute;left:${hr.left};top:9px;transform:translateX(-50%);font-size:10.5px;font-weight:700;color:#9AA7A5;white-space:nowrap;">${hr.label}</span>`).join('')}
          </div>
          <div style="position:absolute;top:32px;bottom:0;left:0;right:0;pointer-events:none;">
            ${tl.hours.map(hr => `<span style="position:absolute;left:${hr.left};top:0;bottom:0;width:1px;background:#EEF2F1;"></span>`).join('')}
            ${tl.nowLeft ? `<span style="position:absolute;left:${tl.nowLeft};top:0;bottom:0;width:2px;background:#FF5F00;"></span>` : ''}
          </div>
          ${tl.lanes.map(ln => `
          <div style="position:relative;height:60px;border-bottom:1px solid #EEF2F1;">
            ${ln.items.map(it => `
            <div style="position:absolute;top:10px;height:40px;left:${it.left};width:${it.width};background:${it.bg};border:1px solid ${it.color};border-left:3px solid ${it.color};border-radius:6px;padding:5px 8px;overflow:hidden;">
              <div style="font-size:11px;font-weight:700;color:#00253D;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;">${esc(it.name)}</div>
              <div style="font-size:9px;color:#6D7C83;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(it.time)}</div>
            </div>`).join('')}
          </div>`).join('')}
          ${tl.nowLeft ? `<div style="position:absolute;left:${tl.nowLeft};top:7px;transform:translateX(-50%);"><span style="font-size:9px;font-weight:800;letter-spacing:0.06em;color:#fff;background:#FF5F00;border-radius:4px;padding:2px 5px;">NOW</span></div>` : ''}
        </div>
      </div>
    </div>`;
  }
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
    <div>
      <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Schedule</h3>
      <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">The full run of the day — list to edit, timeline to see every venue at once.</p>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="display:flex;background:#EEF2F1;border:1px solid #E0E6E5;border-radius:8px;padding:3px;gap:3px;">
        <button data-act="admSchedView" data-view="list" style="padding:7px 13px;border-radius:6px;font-size:12.5px;font-weight:700;background:${isList ? '#00253D' : '#fff'};color:${isList ? '#fff' : '#46545B'};transition:all .15s;">List</button>
        <button data-act="admSchedView" data-view="timeline" style="padding:7px 13px;border-radius:6px;font-size:12.5px;font-weight:700;background:${!isList ? '#00253D' : '#fff'};color:${!isList ? '#fff' : '#46545B'};transition:all .15s;">Timeline</button>
      </div>
      ${isList ? '<button data-act="admSchedAdd" style="background:#FF5F00;color:#011220;font-weight:800;font-size:13px;padding:11px 16px;border-radius:8px;">+ Add block</button>' : ''}
    </div>
  </div>
  ${body}`;
}

// ── Admin → Idols ───────────────────────────────────────────────────────────
// Create/edit hidden-immunity clues, set release times, and mark one found.
function admIdolsSection(ov) {
  const idols = ov.idols || [];
  const foundCount = idols.filter(x => x.found).length;
  const people = (ov.people || []).filter(p => p.team === 'buffalo' || p.team === 'roadhouse');
  // "Award" search — pick the finder; awarding marks the idol found AND logs
  // the idol's points to the finder's tribe.
  const awardPanel = (idol) => {
    if (S.admIdolAward !== idol.id) return '';
    const q = (S.f.admIdolSearch || '').trim().toLowerCase();
    const matches = q ? people.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 6) : [];
    return `
    <div style="padding:12px 18px;border-bottom:1px solid #EEF2F1;background:#FCFBF7;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6D7C83;margin-bottom:7px;">Who found ${esc(idol.title || 'this idol')}? ${idol.points ? `They earn +${idol.points} pts for their tribe.` : '(Set its points in Edit to award any.)'}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input id="idol-award-search" data-live="admIdolSearch" value="${esc(S.f.admIdolSearch || '')}" placeholder="Type the finder's name…" style="flex:1;min-width:0;font-size:13px;color:#00253D;border:1px solid #DCE3E2;border-radius:7px;padding:8px 10px;outline:none;font-family:'Montserrat';"/>
        <button data-act="admIdolAwardCancel" style="flex-shrink:0;font-size:12px;font-weight:700;color:#6D7C83;border:1px solid #DCE3E2;border-radius:7px;padding:8px 11px;">Cancel</button>
      </div>
      ${matches.length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;">${matches.map(p => `
        <button data-act="admIdolAwardPick" data-id="${idol.id}" data-uid="${p.id}" data-name="${esc(p.name)}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1px solid #E0E6E5;border-radius:7px;padding:8px 11px;text-align:left;">
          <span style="font-size:13px;font-weight:700;color:#00253D;">${esc(p.name)}</span>
          ${admTeamChip(p.team)}
        </button>`).join('')}</div>` : (q ? '<div style="font-size:12px;color:#9AA7A5;margin-top:8px;font-style:italic;">No matches.</div>' : '<div style="font-size:11.5px;color:#9AA7A5;margin-top:7px;">Start typing a name…</div>')}
    </div>`;
  };
  const rowHtml = (idol, i) => {
    if (S.admIdolEdit === idol.id) {
      return `
      <div style="padding:16px 18px;border-bottom:1px solid #EEF2F1;background:#FAFCFB;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">${admFieldLabel('Short label')}${admTextInput('id-title', 'idTitle', S.f.idTitle || '', 'Clue ' + (i + 1))}</div>
          <div style="width:170px;">${admFieldLabel('Release time (blank = hidden)')}${admTextInput('id-time', 'idTime', S.f.idTime || '', 'e.g. 1:30 PM')}</div>
          <div style="width:120px;">${admFieldLabel('Points')}${admTextInput('id-points', 'idPoints', S.f.idPoints || '', 'e.g. 10')}</div>
        </div>
        <div style="margin-top:12px;">${admFieldLabel('Clue (hidden from players until release)')}
          <textarea id="id-clue" data-field="idClue" placeholder="Type the clue riddle…" style="width:100%;min-height:70px;font-size:14px;color:#00253D;border:1px solid #DCE3E2;border-radius:8px;padding:11px 12px;font-family:'Montserrat';outline:none;resize:vertical;">${esc(S.f.idClue || '')}</textarea>
        </div>
        <div style="font-size:11px;color:#9AA7A5;margin-top:6px;">Points go to the finder's tribe when you award the idol (needs migration 010).</div>
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button data-act="admIdolSave" data-id="${idol.id}" style="background:#FF5F00;color:#011220;font-weight:800;font-size:13px;padding:10px 16px;border-radius:8px;">Save clue</button>
          <button data-act="admIdolCancel" style="color:#6D7C83;font-weight:700;font-size:13px;padding:10px 12px;border-radius:8px;border:1px solid #DCE3E2;">Cancel</button>
        </div>
      </div>`;
    }
    const releaseLabel = idol.releaseMin != null ? minToLabel(idol.releaseMin) : 'Hidden (no release time)';
    return `
    <div style="display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid #EEF2F1;">
      <span style="width:30px;height:30px;border-radius:50%;background:${idol.found ? '#FF5F00' : '#EEF2F1'};color:${idol.found ? '#011220' : '#6D7C83'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'BN Kragen';font-size:13px;">${i + 1}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:14px;font-weight:700;color:#00253D;">${esc(idol.title || 'Clue ' + (i + 1))}</span>
          ${idol.points ? `<span style="font-size:10px;font-weight:800;color:#8A5A12;background:#FCEFDD;border:1px solid #F0D9BB;border-radius:5px;padding:1px 7px;">+${idol.points} pts</span>` : ''}
        </div>
        <div style="font-size:12px;color:#6D7C83;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${idol.clue ? esc(idol.clue) : '<span style="font-style:italic;color:#9AA7A5;">No clue text yet</span>'}</div>
        <div style="font-size:11px;font-weight:700;color:${idol.releaseMin != null ? '#00253D' : '#9AA7A5'};margin-top:3px;">${idol.releaseMin != null ? '⏱ ' + esc(releaseLabel) : esc(releaseLabel)}${idol.found && idol.foundBy ? ` · <span style="color:#1F8A5B;">Found by ${esc(idol.foundBy)}</span>` : ''}</div>
      </div>
      ${idol.found
        ? `<button data-act="admIdolFound" data-id="${idol.id}" style="flex-shrink:0;font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:6px;background:#1F8A5B;color:#fff;border:1px solid #1F8A5B;">Found ✓</button>`
        : `<button data-act="admIdolAwardOpen" data-id="${idol.id}" style="flex-shrink:0;font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:6px;background:transparent;color:#6D7C83;border:1px solid #C9D3D2;">🏆 Award</button>`}
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button data-act="admIdolEdit" data-id="${idol.id}" style="height:30px;padding:0 11px;border-radius:6px;border:1px solid #DCE3E2;color:#00253D;font-size:12px;font-weight:700;">Edit</button>
        <button data-act="admIdolDelete" data-id="${idol.id}" data-title="${esc(idol.title || 'this clue')}" style="width:30px;height:30px;border-radius:6px;border:1px solid #F0CDB3;color:#C77B23;display:flex;align-items:center;justify-content:center;font-size:16px;">×</button>
      </div>
    </div>${awardPanel(idol)}`;
  };
  return `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
    <div>
      <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Idols</h3>
      <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Hidden-immunity clues — all hidden by default. Type each clue, set a release time and its points, then hit 🏆 Award and pick the finder — their tribe gets the points automatically. ${foundCount} of ${idols.length} found.</p>
    </div>
    <button data-act="admIdolAdd" style="flex-shrink:0;background:#FF5F00;color:#011220;font-weight:800;font-size:13px;padding:11px 16px;border-radius:8px;">+ Add clue</button>
  </div>
  <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
    ${idols.length ? idols.map(rowHtml).join('') : '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No clues yet — add one to start the idol hunt.</div>'}
  </div>`;
}

function admDipSection(ov) {
  const dip = ov.dip || { entries: [], counts: { buffalo: 0, roadhouse: 0 }, totalVotes: 0, revealed: false };
  const maxVotes = dip.entries.length ? Math.max.apply(null, dip.entries.map(d => d.votes)) : 0;
  const rows = dip.entries.map(d => {
    const win = dip.revealed && maxVotes > 0 && d.votes === maxVotes;
    return `
    <div style="display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid #EEF2F1;background:${win ? '#FFF4EC' : '#fff'};">
      <span style="width:54px;flex-shrink:0;font-family:'BN Kragen';font-size:18px;color:#00253D;">${d.no}</span>
      <span style="flex:1;font-size:14px;font-weight:700;color:#00253D;display:flex;align-items:center;gap:8px;">${esc(d.name)}${win ? '<span style="font-size:9px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#011220;background:#FF5F00;border-radius:4px;padding:2px 7px;">Winner</span>' : ''}</span>
      <span style="width:150px;flex-shrink:0;">${teamPill(d.team)}</span>
      <span style="width:70px;flex-shrink:0;text-align:right;font-family:'BN Kragen';font-size:18px;color:#00253D;">${d.votes}</span>
      <button data-act="admDipRemove" data-id="${d.id}" style="width:34px;flex-shrink:0;color:#C77B23;font-size:18px;text-align:center;">×</button>
    </div>`;
  }).join('');
  const statCard = (val, sub, color) => `<div style="flex:1;min-width:120px;background:#fff;border:1px solid #E0E6E5;border-radius:10px;padding:13px 15px;"><div style="font-family:'BN Kragen';font-size:26px;color:${color};line-height:1;">${val}</div><div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;margin-top:5px;">${sub}</div></div>`;
  return `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px;">
    <div>
      <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Dip Off</h3>
      <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Five cooks per tribe. Everyone votes on judging day — one vote each, dips stay anonymous to voters.</p>
    </div>
    <button data-act="admDipReveal" style="flex-shrink:0;background:${dip.revealed ? '#FF5F00' : '#fff'};color:${dip.revealed ? '#011220' : '#FF5F00'};border:1px solid #FF5F00;font-weight:800;font-size:13px;padding:11px 16px;border-radius:8px;">${dip.revealed ? 'Hide winner' : 'Reveal winner'}</button>
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px;">
    ${statCard((dip.counts.buffalo || 0) + '<span style="font-size:15px;color:#9AA7A5;"> / 5</span>', 'Buffalo cooks', '#FF5F00')}
    ${statCard((dip.counts.roadhouse || 0) + '<span style="font-size:15px;color:#9AA7A5;"> / 5</span>', 'Roadhouse cooks', '#E0322E')}
    ${statCard(dip.entries.length, 'Dips entered', '#00253D')}
    ${statCard(dip.totalVotes || 0, 'Votes cast', '#00253D')}
  </div>
  <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:14px;padding:11px 18px;background:#EEF2F1;border-bottom:1px solid #E0E6E5;font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;">
      <span style="width:54px;flex-shrink:0;">Dip #</span><span style="flex:1;">Cook</span><span style="width:150px;flex-shrink:0;">Tribe</span><span style="width:70px;flex-shrink:0;text-align:right;">Votes</span><span style="width:34px;flex-shrink:0;"></span>
    </div>
    ${rows || '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No dip entries yet.</div>'}
  </div>`;
}

function admRelaySection(ov) {
  const relay = ov.relay || { legs: [], roster: {}, total: 0 };
  const rows = (relay.legs || []).map(l => {
    const r = (relay.roster || {})[l.id] || { buffalo: [], roadhouse: [] };
    return `
    <div style="background:#fff;border:1px solid #E0E6E5;border-left:3px solid #FF5F00;border-radius:10px;padding:15px 16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <input data-leg="${esc(l.id)}" data-debounce="legName" value="${esc(l.name)}" style="flex:1;min-width:180px;font-family:'Montserrat';font-size:15px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:7px;padding:9px 12px;outline:none;"/>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6D7C83;">Per team</span>
          <button data-act="admLegCap" data-id="${esc(l.id)}" data-d="-1" style="width:30px;height:30px;border-radius:7px;border:1px solid #DCE3E2;color:#00253D;font-size:17px;display:flex;align-items:center;justify-content:center;">−</button>
          <span style="width:26px;text-align:center;font-family:'BN Kragen';font-size:19px;color:#FF5F00;">${l.cap}</span>
          <button data-act="admLegCap" data-id="${esc(l.id)}" data-d="1" style="width:30px;height:30px;border-radius:7px;border:1px solid #DCE3E2;color:#00253D;font-size:17px;display:flex;align-items:center;justify-content:center;">+</button>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;background:#FBF4EE;border:1px solid #F3DFCC;border-radius:8px;padding:10px 12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#C2741C;">Buffalo</span><span style="font-size:11px;font-weight:700;color:${r.buffalo.length >= l.cap ? '#1F8A5B' : '#6D7C83'};">${r.buffalo.length} / ${l.cap}</span></div>
          <div style="font-size:12.5px;color:#46545B;margin-top:4px;line-height:1.4;">${esc(r.buffalo.join(', ') || '—')}</div>
        </div>
        <div style="flex:1;min-width:200px;background:#F6F8F7;border:1px solid #E0E6E5;border-radius:8px;padding:10px 12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#B0353A;">Texas Roadhouse</span><span style="font-size:11px;font-weight:700;color:${r.roadhouse.length >= l.cap ? '#1F8A5B' : '#6D7C83'};">${r.roadhouse.length} / ${l.cap}</span></div>
          <div style="font-size:12.5px;color:#46545B;margin-top:4px;line-height:1.4;">${esc(r.roadhouse.join(', ') || '—')}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  return `
  <div style="margin-bottom:16px;">
    <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Relay Race</h3>
    <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Rename each leg and set its headcount. Anyone may sign up for one leg only — no matter how many other games they're in. <strong style="color:#46545B;">${relay.total || 0} teammates</strong> signed up so far.</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px;">${rows}</div>`;
}

function admScoresSection(ov) {
  const revealed = !!(ov.settings && ov.settings.scoresRevealed);
  const peek = S.adminPeek || (revealed ? ov.scores : null);
  const showTotals = !!peek;
  let totalPanel = '';
  if (!showTotals) {
    totalPanel = `
    <div style="background:#fff;border:1px solid #E0E6E5;border-radius:12px;padding:26px;text-align:center;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" style="margin-bottom:10px;"><rect x="4" y="10" width="16" height="10" rx="2" stroke="#9AA7A5" stroke-width="2"/><path d="M7.5 10V7a4.5 4.5 0 019 0v3" stroke="#9AA7A5" stroke-width="2"/></svg>
      <div style="font-family:'BN Kragen';font-size:20px;color:#00253D;text-transform:uppercase;">Scores are hidden</div>
      <p style="font-size:12.5px;color:#6D7C83;margin:7px 0 16px;">Keeping the running total out of sight keeps the day suspenseful.</p>
      <button data-act="admPeek" style="background:#00253D;color:#fff;font-weight:700;font-size:13.5px;padding:11px 18px;border-radius:8px;">Peek at totals (admin only)</button>
    </div>`;
  } else {
    totalPanel = `
    <div style="background:#fff;border:1px solid #E0E6E5;border-radius:12px;padding:20px;">
      <div style="display:flex;gap:14px;">
        <div style="flex:1;background:#FF5F00;border-radius:10px;padding:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#00253D;">Buffalo</div>
          <div style="font-family:'BN Kragen';font-size:44px;color:#011220;line-height:0.9;margin-top:4px;">${peek.buffalo}</div>
        </div>
        <div style="flex:1;background:#141210;border-radius:10px;padding:16px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#F5C518;">Texas Roadhouse</div>
          <div style="font-family:'BN Kragen';font-size:44px;color:#E0322E;line-height:0.9;margin-top:4px;">${peek.roadhouse}</div>
        </div>
      </div>
      ${!revealed ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;">
        <span style="font-size:12px;color:#6D7C83;">Only you can see this. Players still see a sealed board.</span>
        <button data-act="admHidePeek" style="font-size:12.5px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:7px;padding:8px 13px;flex-shrink:0;">Hide again</button>
      </div>` : `
      <div style="display:flex;align-items:center;gap:8px;margin-top:14px;color:#1F8A5B;">
        ${checkSvg('#1F8A5B', 16)}
        <span style="font-size:12.5px;font-weight:700;">Published — live on every phone.</span>
      </div>`}
    </div>`;
  }
  let revealCtl = '';
  if (!revealed) {
    revealCtl = S.adminConfirmReveal ? `
    <div style="margin-top:16px;background:#FFF4EC;border:1px solid #FFD3B5;border-radius:12px;padding:20px;">
      <div style="font-family:'BN Kragen';font-size:19px;color:#00253D;text-transform:uppercase;">Are you sure?</div>
      <p style="font-size:13px;color:#6D7C83;margin:7px 0 16px;line-height:1.5;">This publishes the final standings to every phone in both tribes. You can't un-ring this bell — make sure the day is done.</p>
      <div style="display:flex;gap:10px;">
        <button data-act="admCancelReveal" style="flex:1;background:#fff;border:1px solid #DCE3E2;color:#00253D;font-weight:700;font-size:14px;padding:13px;border-radius:8px;">Cancel</button>
        <button data-act="admConfirmReveal" style="flex:1;background:#FF5F00;color:#011220;font-weight:800;font-size:14px;padding:13px;border-radius:8px;">Yes, reveal scores</button>
      </div>
    </div>` : `
    <div style="margin-top:16px;">
      <button data-act="admAskReveal" style="width:100%;background:#FF5F00;color:#011220;font-weight:800;font-size:15px;padding:16px;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 6px 18px rgba(255,95,0,0.28);">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="#011220" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="#011220" stroke-width="2"/></svg>
        Reveal scores to everyone
      </button>
    </div>`;
  } else {
    // Already revealed — offer the undo (for "I pressed it to test it").
    revealCtl = `
    <div style="margin-top:16px;display:flex;align-items:center;gap:12px;background:#F6F8F7;border:1px solid #E6ECEA;border-radius:10px;padding:13px 15px;">
      <span style="flex:1;font-size:12px;color:#6D7C83;line-height:1.45;">Pressed Reveal by mistake? Re-sealing hides the standings again on every phone (within their next refresh).</span>
      <button data-act="admUnreveal" style="flex-shrink:0;background:#fff;border:1px solid #DCE3E2;color:#00253D;font-weight:700;font-size:12.5px;padding:10px 14px;border-radius:8px;">🔒 Re-seal scores</button>
    </div>`;
  }
  const log = (ov.results || []).map(r => {
    const color = r.winner === 'buffalo' || r.winner === 'Buffalo' ? '#FF5F00' : (r.winner === 'roadhouse' || r.winner === 'Texas Roadhouse' ? '#E0322E' : '#6D7C83');
    const editing = S.editingId === r.id;
    const histOpen = S.historyOpenId === r.id;
    return `
    <div style="padding:13px 16px;border-bottom:1px solid #EEF2F1;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:#00253D;">${esc(r.game)}</div>
          <div style="font-size:12px;color:#6D7C83;margin-top:1px;">${esc(r.detail || '')}</div>
        </div>
        ${editing ? `
        <div style="display:flex;align-items:center;gap:7px;flex-shrink:0;">
          <input id="adm-edit-val" data-field="editVal" value="${esc(S.editVal)}" inputmode="numeric" style="width:58px;font-family:'Montserrat';font-size:15px;font-weight:700;color:#00253D;text-align:center;border:1px solid #FF5F00;border-radius:7px;padding:7px 6px;"/>
          <button data-act="admEditSave" data-id="${r.id}" style="background:#FF5F00;color:#011220;font-weight:800;font-size:12px;padding:8px 11px;border-radius:7px;">Save</button>
          <button data-act="admEditCancel" style="color:#6D7C83;font-weight:700;font-size:12px;padding:8px 9px;border-radius:7px;border:1px solid #DCE3E2;">Cancel</button>
        </div>` : `
        <div style="display:flex;align-items:center;gap:11px;flex-shrink:0;">
          <span style="font-family:'BN Kragen';font-size:19px;color:${color};">+${r.pts}</span>
          <button data-act="admEditStart" data-id="${r.id}" data-pts="${r.pts}" style="font-size:12px;font-weight:700;color:#FF5F00;border:1px solid #FFD3B5;border-radius:7px;padding:7px 11px;">Edit</button>
        </div>`}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px;margin-left:21px;flex-wrap:wrap;">
        <span style="font-size:11px;color:#9AA7A5;">Entered by <strong style="color:#46545B;">${esc(r.enteredBy || '—')}</strong> · ${timeAgo(r.createdAt)}</span>
        ${r.editedBy ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#C77B23;background:#FCEFE2;border-radius:5px;padding:2px 7px;">Edited by ${esc(r.editedBy)}</span>` : ''}
        ${(r.history || []).length ? `<button data-act="admHistory" data-id="${r.id}" style="font-size:11px;font-weight:700;color:#00253D;text-decoration:underline;">View history</button>` : ''}
      </div>
      ${histOpen ? `
      <div style="margin-top:10px;margin-left:21px;background:#F6F8F7;border:1px solid #E6ECEA;border-radius:8px;padding:11px 13px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9AA7A5;margin-bottom:8px;">Previous values</div>
        ${(r.history || []).map(hh => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;">
          <span style="font-size:12.5px;color:#46545B;">${timeAgo(hh.when)} · by ${esc(hh.by || '—')}</span>
          <span style="font-family:'BN Kragen';font-size:15px;color:#6D7C83;">${hh.pts}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('');
  return `
  <div style="margin-bottom:18px;">
    <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Team Scores</h3>
    <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Totals stay hidden by default — even from you — until you choose to look or publish.</p>
  </div>
  <div style="max-width:520px;">${totalPanel}${revealCtl}</div>
  <div style="margin-top:24px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;">Live entry log</div>
      <div style="font-size:11px;color:#9AA7A5;">${(ov.results || []).length} entries · totals stay hidden above</div>
    </div>
    <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
      ${log || '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No results logged yet.</div>'}
    </div>
  </div>
  <div style="margin-top:28px;max-width:520px;background:#FFF5F5;border:1px solid #F3C9C7;border-radius:12px;padding:20px;">
    <div style="font-family:'BN Kragen';font-size:18px;color:#B4231F;text-transform:uppercase;line-height:1;">Danger zone</div>
    <p style="font-size:12.5px;color:#8A5B59;margin:8px 0 15px;line-height:1.5;">Clearing scores permanently deletes <strong>every logged result and its history</strong> and re-seals the board. Use this to wipe test data before the real event — it can't be undone.</p>
    <button data-act="admResetScores" style="background:#E0322E;color:#fff;font-weight:800;font-size:13.5px;padding:12px 18px;border-radius:8px;">Reset all scores</button>
  </div>`;
}

function admRefsSection(ov) {
  const needsRef = (ov.gamesCatalog || []).filter(g => g.needsRef);
  const refById = {};
  for (const rf of (ov.refs || [])) refById[rf.id] = rf.name;
  const rows = needsRef.map(g => {
    // Multi-ref (migration 010): any number of refs can cover a game.
    const raw = (ov.refAssignments || {})[g.id];
    const assigned = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const addable = (ov.refs || []).filter(rf => !assigned.includes(rf.id));
    return `
    <div style="display:flex;align-items:center;gap:16px;padding:13px 18px;border-bottom:1px solid #EEF2F1;">
      <div style="width:220px;flex-shrink:0;min-width:0;">
        <div style="font-size:14px;font-weight:700;color:#00253D;">${esc(g.name)}</div>
        <div style="font-size:12px;color:#6D7C83;margin-top:2px;">${esc(g.venue || '')}</div>
      </div>
      <div style="flex:1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        ${assigned.map(uid => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#011220;background:#FFEDE0;border:1px solid #FFD3B5;border-radius:6px;padding:5px 8px;">${esc(refById[uid] || 'Ref #' + uid)}<button data-act="admRefRemove" data-gid="${esc(g.id)}" data-uid="${uid}" style="color:#C77B23;font-weight:800;font-size:14px;line-height:1;">×</button></span>`).join('')}
        ${assigned.length === 0 ? '<span style="font-size:12px;color:#C77B23;font-weight:700;">No ref yet</span>' : ''}
        ${addable.length ? `<select data-change="admRefAssign" data-gid="${esc(g.id)}" style="font-size:12px;font-weight:700;color:#FF5F00;background:#fff;border:1px dashed #FF5F00;border-radius:6px;padding:5px 8px;cursor:pointer;">
          <option value="">+ Add ref</option>
          ${addable.map(rf => `<option value="${rf.id}">${esc(rf.name)}</option>`).join('')}
        </select>` : ''}
      </div>
    </div>`;
  }).join('');
  return `
  <div style="margin-bottom:16px;">
    <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Referees</h3>
    <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Referees create their own account with the shared join code below — no approval needed. Any number of refs can cover the same game; refs can also add games themselves from their phone.</p>
  </div>
  <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;padding:18px;margin-bottom:20px;max-width:540px;">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:11px;">
      ${shieldSvg('#FF5F00')}
      <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;">Referee join code</div>
    </div>
    <p style="font-size:12.5px;color:#6D7C83;margin:0 0 13px;line-height:1.5;">Anyone with this code can create a referee account from the sign-in screen. Change it any time to retire an old code.</p>
    <div style="display:flex;align-items:center;gap:10px;">
      <input id="adm-refcode" data-debounce="refCode" value="${esc(S.f.refCodeDraft !== undefined ? S.f.refCodeDraft : ((ov.settings && ov.settings.refJoinCode) || ''))}" style="flex:1;font-family:'Montserrat';font-size:16px;font-weight:800;letter-spacing:0.05em;color:#00253D;border:1px solid #DCE3E2;border-radius:8px;padding:12px 14px;outline:none;"/>
      <span style="font-size:11px;font-weight:700;color:#1F8A5B;display:flex;align-items:center;gap:5px;flex-shrink:0;">${checkSvg('#1F8A5B', 14)}Saved live</span>
    </div>
  </div>
  <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;margin-bottom:10px;">Ref assignments</div>
  <div style="background:#fff;border:1px solid #E0E6E5;border-radius:10px;overflow:hidden;">
    ${rows || '<div style="padding:20px;font-size:13px;color:#9AA7A5;font-style:italic;">No games need a ref.</div>'}
  </div>`;
}

function admAnnounceSection(ov) {
  return `
  <div style="margin-bottom:16px;">
    <h3 style="font-family:'BN Kragen';font-size:26px;color:#00253D;text-transform:uppercase;line-height:1;margin:0;">Announcements</h3>
    <p style="font-size:13px;color:#6D7C83;margin:5px 0 0;">Push a message to every phone in both tribes.</p>
  </div>
  <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
    <div style="width:380px;flex-shrink:0;background:#fff;border:1px solid #E0E6E5;border-radius:10px;padding:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF7F2E;margin-bottom:11px;">New announcement</div>
      <input id="ann-title" data-field="annTitle" value="${esc(S.f.annTitle || '')}" placeholder="Headline" style="width:100%;font-size:14px;font-weight:700;color:#00253D;border:1px solid #DCE3E2;border-radius:7px;padding:11px 12px;margin-bottom:10px;font-family:'Montserrat';outline:none;"/>
      <textarea id="ann-body" data-field="annBody" placeholder="What do the tribes need to know?" style="width:100%;height:96px;resize:none;font-size:13px;color:#00253D;border:1px solid #DCE3E2;border-radius:7px;padding:11px 12px;font-family:'Montserrat';line-height:1.5;outline:none;">${esc(S.f.annBody || '')}</textarea>
      <button data-act="admAnnPush" style="width:100%;margin-top:12px;background:#FF5F00;color:#011220;font-weight:800;font-size:14px;text-align:center;padding:13px;border-radius:8px;">Push to all phones</button>
    </div>
    <div style="flex:1;min-width:260px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6D7C83;margin-bottom:11px;">Sent today</div>
      <div style="display:flex;flex-direction:column;gap:11px;">
        ${(ov.announcements || []).map(a => `
        <div style="background:#fff;border:1px solid #E0E6E5;border-left:3px solid #FF5F00;border-radius:10px;padding:14px 16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <span style="font-size:14px;font-weight:800;color:#00253D;">${esc(a.title)}</span>
            <span style="font-size:11px;color:#9AA7A5;flex-shrink:0;">Pushed ${fmtClock(a.createdAt)}</span>
          </div>
          <p style="font-size:13px;color:#46545B;line-height:1.5;margin:6px 0 0;">${esc(a.body || '')}</p>
        </div>`).join('') || '<div style="font-size:12.5px;color:#9AA7A5;font-style:italic;">Nothing sent yet.</div>'}
      </div>
    </div>
  </div>`;
}

function adminScreen() {
  const ov = S.overview;
  const user = S.boot.user;
  if (!ov) {
    return `<div style="flex:1;display:flex;align-items:center;justify-content:center;background:#F3F7F5;color:#6D7C83;font-size:14px;padding:40px;">Loading the Admin Center…</div>`;
  }
  const sections = [
    { id: 'people', label: 'People' }, { id: 'songs', label: 'Songs' }, { id: 'games', label: 'Games' },
    { id: 'schedule', label: 'Schedule' }, { id: 'idols', label: 'Idols' },
    { id: 'dipoff', label: 'Dip Off' }, { id: 'relay', label: 'Relay Race' },
    { id: 'scores', label: 'Scores' }, { id: 'refs', label: 'Referees' }, { id: 'announce', label: 'Announcements' },
  ];
  const isSignup = (ov.settings && ov.settings.eventMode) !== 'gameday';
  let body = '';
  if (S.adminSection === 'people') body = admPeopleSection(ov);
  else if (S.adminSection === 'songs') body = admSongsSection(ov);
  else if (S.adminSection === 'games') body = admGamesSection(ov);
  else if (S.adminSection === 'schedule') body = admScheduleSection(ov);
  else if (S.adminSection === 'idols') body = admIdolsSection(ov);
  else if (S.adminSection === 'dipoff') body = admDipSection(ov);
  else if (S.adminSection === 'relay') body = admRelaySection(ov);
  else if (S.adminSection === 'scores') body = admScoresSection(ov);
  else if (S.adminSection === 'refs') body = admRefsSection(ov);
  else if (S.adminSection === 'announce') body = admAnnounceSection(ov);

  const stat = (val, label, color) => `
  <div style="flex:1;min-width:120px;background:#fff;border:1px solid #E0E6E5;border-radius:10px;padding:13px 15px;">
    <div style="font-family:'BN Kragen';font-size:26px;color:${color || '#00253D'};line-height:1;">${val}</div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6D7C83;margin-top:5px;">${label}</div>
  </div>`;

  return `
  <div class="scrl" style="flex:1;min-height:0;overflow:auto;background:#F3F7F5;">
    <div style="min-width:1024px;height:100%;display:flex;min-height:0;">
      <div style="width:230px;flex-shrink:0;background:#00253D;display:flex;flex-direction:column;padding:22px 0;">
        <div style="display:flex;align-items:center;gap:9px;padding:0 22px 22px;">
          <img src="/assets/logos/buffalo-orange.png" alt="" style="height:22px;"/>
          <div style="line-height:1;">
            <div style="font-family:'BN Kragen';font-size:16px;color:#F3F7F5;">BUFF OLYMPICS</div>
            <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#FF7F2E;margin-top:3px;">Admin Center</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;padding:0 12px;">
          ${sections.map(n => {
            const on = n.id === S.adminSection;
            return `<button data-act="admSection" data-id="${n.id}" style="display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:8px;font-size:14px;font-weight:600;color:${on ? '#F3F7F5' : '#8AA7B9'};background:${on ? 'rgba(255,255,255,0.08)' : 'transparent'};transition:all .15s;">
              <span style="width:6px;height:6px;border-radius:50%;background:${on ? '#FF5F00' : 'rgba(255,255,255,0.18)'};"></span>${n.label}
            </button>`;
          }).join('')}
        </div>
        <div style="margin:20px 12px 0;padding:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:10px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FF7F2E;margin-bottom:9px;">Event mode</div>
          <div style="display:flex;background:rgba(0,0,0,0.30);border-radius:8px;padding:3px;gap:3px;">
            <button data-act="admMode" data-mode="signup" style="flex:1;padding:8px;border-radius:6px;font-size:11.5px;font-weight:700;text-align:center;background:${isSignup ? '#FF5F00' : 'transparent'};color:${isSignup ? '#011220' : '#8AA7B9'};transition:all .15s;">Sign-Up</button>
            <button data-act="admMode" data-mode="gameday" style="flex:1;padding:8px;border-radius:6px;font-size:11.5px;font-weight:700;text-align:center;background:${!isSignup ? '#FF5F00' : 'transparent'};color:${!isSignup ? '#011220' : '#8AA7B9'};transition:all .15s;">Game Day</button>
          </div>
          <div style="font-size:10.5px;color:#8AA7B9;margin-top:9px;line-height:1.45;">
            ${isSignup ? 'Sign-ups open — players can join games, the Dip Off &amp; the relay.' : 'Sign-ups locked — dip voting is live on every phone.'}
          </div>
        </div>
        <div style="margin-top:auto;padding:18px 22px 0;border-top:1px solid rgba(255,255,255,0.10);margin-left:12px;margin-right:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="width:34px;height:34px;border-radius:8px;background:#FF5F00;display:flex;align-items:center;justify-content:center;font-family:'BN Kragen';font-size:13px;color:#011220;">${esc(initials(user.name))}</span>
            <div style="line-height:1.2;">
              <div style="font-size:13px;font-weight:700;color:#F3F7F5;">${esc(user.name)}</div>
              <div style="font-size:11px;color:#8AA7B9;">Event Admin</div>
            </div>
          </div>
        </div>
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;background:#F3F7F5;">
        <div style="flex-shrink:0;padding:20px 28px;border-bottom:1px solid #DCE3E2;display:flex;gap:14px;flex-wrap:wrap;">
          ${stat(ov.stats.people, 'Participants')}
          ${stat(ov.stats.games, 'Games')}
          ${stat(ov.stats.refs, 'Referees', '#FF5F00')}
          ${stat(ov.stats.admins, 'Admins')}
        </div>
        <div class="scrl" id="bo-adm-content" style="flex:1;overflow-y:auto;padding:24px 28px 40px;">${body}</div>
      </div>
    </div>
  </div>`;
}

/* ════════════════════ shell: bars + nav ════════════════════ */
const BACK_ROUTES = { game: 'games', dip: 'home', 'dip-vote': 'home', relay: 'home' };
function topBar() {
  const T = theme();
  const back = BACK_ROUTES[S.route];
  return `
  <div style="height:54px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid rgba(255,255,255,0.07);position:relative;z-index:20;background:${T.th.bar};">
    ${back ? `
    <button data-act="go" data-to="${back}" style="display:flex;align-items:center;gap:6px;color:#8AA7B9;font-size:13px;font-weight:600;">
      ${chevL(T.A)}
      Back
    </button>` : `
    <div style="display:flex;align-items:center;gap:9px;">
      <img src="/assets/logos/buffalo-orange.png" alt="" style="height:21px;width:auto;display:block;"/>
      <span style="font-family:'BN Kragen';font-size:19px;letter-spacing:0.01em;color:#F3F7F5;line-height:1;">BUFF OLYMPICS</span>
    </div>`}
    <div style="display:flex;align-items:center;gap:8px;font-size:10.5px;font-weight:700;letter-spacing:0.1em;color:#8AA7B9;text-transform:uppercase;">
      <span style="width:7px;height:7px;border-radius:50%;background:${T.A};box-shadow:0 0 8px ${T.A};"></span>Aug 14 · Live
    </div>
  </div>`;
}
function tabBar() {
  const T = theme();
  const th = T.th;
  const activeTab = S.route === 'game' ? 'games' : (['dip', 'dip-vote', 'relay'].includes(S.route) ? 'home' : S.route);
  const tc = k => k === activeTab ? T.A : th.tabIdle;
  return `
  <div style="height:74px;flex-shrink:0;background:${th.bar};border-top:1px solid rgba(255,255,255,0.09);display:flex;align-items:flex-start;padding:9px 6px 0;position:relative;z-index:20;">
    <button data-act="go" data-to="home" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:${tc('home')};">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="font-size:10px;font-weight:700;">Home</span>
    </button>
    <button data-act="go" data-to="games" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:${tc('games')};">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 21V4M5 4h12l-2 4 2 4H5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span style="font-size:10px;font-weight:700;">Games</span>
    </button>
    <button data-act="go" data-to="schedule" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:${tc('schedule')};">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M4 9h16M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span style="font-size:10px;font-weight:700;">Schedule</span>
    </button>
    <button data-act="go" data-to="tribes" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:${tc('tribes')};">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 5.5a3 3 0 010 5.4M18 20c0-2.5-1-4.5-2.5-5.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span style="font-size:10px;font-weight:700;">Tribes</span>
    </button>
    <button data-act="go" data-to="score" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;color:${tc('score')};">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v3a5 5 0 01-10 0V4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 5H3v2a3 3 0 003 3M19 5h2v2a3 3 0 01-3 3M9 20h6M12 13v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span style="font-size:10px;font-weight:700;">Score</span>
    </button>
  </div>`;
}
function deskNav() {
  const T = theme();
  const user = S.boot.user;
  const link = (to, label) => {
    const on = S.route === to || (to === 'games' && S.route === 'game');
    return `<button data-act="go" data-to="${to}" style="padding:8px 13px;border-radius:7px;font-size:13px;font-weight:700;color:${on ? '#F3F7F5' : '#8AA7B9'};background:${on ? 'rgba(255,255,255,0.08)' : 'transparent'};">${label}</button>`;
  };
  return `
  <div style="height:56px;flex-shrink:0;background:#011220;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:6px;padding:0 20px;">
    <button data-act="go" data-to="home" style="display:flex;align-items:center;gap:9px;margin-right:16px;">
      <img src="/assets/logos/buffalo-orange.png" alt="" style="height:22px;width:auto;display:block;"/>
      <span style="font-family:'BN Kragen';font-size:18px;color:#F3F7F5;line-height:1;">BUFF OLYMPICS</span>
    </button>
    ${link('home', 'Home')}${link('games', 'Games')}${link('schedule', 'Schedule')}${link('tribes', 'Tribes')}${link('score', 'Score')}
    ${user.isAdmin ? `<button data-act="go" data-to="admin" style="padding:8px 13px;border-radius:7px;font-size:13px;font-weight:800;color:${S.route === 'admin' ? '#011220' : '#FF7F2E'};background:${S.route === 'admin' ? '#FF5F00' : 'rgba(255,95,0,0.12)'};border:1px solid rgba(255,127,46,0.4);margin-left:6px;">Admin Center</button>` : ''}
    <div style="margin-left:auto;display:flex;align-items:center;gap:12px;">
      <span style="font-size:12px;font-weight:700;color:#8AA7B9;">${esc(user.name)} · ${esc(theme().myTeamName)}</span>
      <button data-act="signOut" style="font-size:12px;font-weight:700;color:#C7D3DB;border:1px solid rgba(255,255,255,0.18);border-radius:7px;padding:7px 12px;">Sign out</button>
    </div>
  </div>`;
}

/* ════════════════════ loading / error ════════════════════ */
function loadingScreen() {
  return `
  <div style="min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#01121F;">
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px;animation:boPulse 1.6s ease-in-out infinite;">
      <img src="/assets/logos/buffalo-orange.png" alt="" style="height:64px;width:auto;"/>
      <div style="font-family:'BN Kragen';font-size:26px;color:#F3F7F5;letter-spacing:0.02em;">BUFF OLYMPICS</div>
    </div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#FF7F2E;">Saddling up…</div>
  </div>`;
}
function bootErrorScreen() {
  return `
  <div style="min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#01121F;padding:32px;text-align:center;">
    <img src="/assets/logos/buffalo-orange.png" alt="" style="height:48px;width:auto;opacity:0.9;"/>
    <div style="font-family:'BN Kragen';font-size:24px;color:#F3F7F5;text-transform:uppercase;">The herd hit a snag</div>
    <div style="font-size:13px;color:#C7D3DB;max-width:340px;line-height:1.6;">We couldn't load the event. The server said:<br/><span style="color:#FF7F2E;font-weight:700;">${esc(S.bootError || 'Unknown error')}</span></div>
    <button data-act="retryBoot" style="background:#FF5F00;color:#011220;font-weight:800;font-size:14px;padding:13px 26px;border-radius:9px;box-shadow:0 8px 22px rgba(255,95,0,0.28);margin-top:6px;">Retry</button>
    <button data-act="signOut" style="font-size:12px;font-weight:700;color:#8AA7B9;text-decoration:underline;">Sign out</button>
  </div>`;
}

/* ════════════════════ render ════════════════════ */
function screenHtml() {
  const ref = isRefUser();
  switch (S.route) {
    case 'home': return ref ? refBoardScreen() : homeScreen();
    case 'games': return ref ? refGamesScreen() : gamesScreen();
    case 'game': return ref ? refGamesScreen() : gameDetailScreen();   // refs never sign up for games
    case 'schedule': return scheduleScreen();
    case 'tribes': return tribesScreen();
    case 'score': return ref ? refBoardScreen() : scoreScreen();
    case 'immunity': return immunityScreen();
    case 'dip': return dipSignupScreen();
    case 'dip-vote': return dipVoteScreen();
    case 'relay': return relayScreen();
    default: return homeScreen();
  }
}
let lastRenderedRoute = null;
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  // preserve focus + caret across re-renders
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  let selStart = null, selEnd = null;
  if (focusId && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) { /* number inputs */ }
  }
  // preserve scroll of the content area on same-screen re-renders. The admin
  // screen scrolls inside its own container (#bo-adm-content), not #bo-content,
  // so track that too — otherwise every 60s poll or admin action snaps the
  // Admin Center back to the top. The screen key includes the admin section so
  // switching sections still resets to the top (a fresh screen).
  const screenKey = S.route + '/' + (S.routeArg || '') + '/' + (S.route === 'admin' ? S.adminSection : '');
  const prevContent = document.getElementById('bo-content');
  const prevAdm = document.getElementById('bo-adm-content');
  const sameScreen = lastRenderedRoute === screenKey;
  const prevScroll = (sameScreen && prevContent) ? prevContent.scrollTop : 0;
  const prevAdmScroll = (sameScreen && prevAdm) ? prevAdm.scrollTop : 0;
  const prevWin = sameScreen ? window.scrollY : 0;

  let html = '';
  if (!S.token) {
    html = authScreen();
  } else if (S.loading && !S.boot) {
    html = loadingScreen();
  } else if (!S.boot) {
    html = S.bootError ? bootErrorScreen() : loadingScreen();
  } else if (!isRefUser() && (!S.boot.user.team || S.forceTeamGate)) {
    // Refs have no tribe — they never see the team gate; they go to the ref board.
    html = teamGateScreen();
  } else if (S.route === 'admin') {
    if (!S.boot.user.isAdmin) { location.hash = '#/home'; return; }
    html = `
    <div style="height:100vh;height:100dvh;display:flex;flex-direction:column;">
      ${deskNav()}
      ${adminScreen()}
    </div>
    ${admGamesModals()}`;
  } else if (S.isDesk && S.route === 'games' && !isRefUser()) {
    // Players get the rich desktop sign-up board; REFS never do — their
    // desktop experience mirrors the mobile ref board (phone column below).
    html = `
    <div style="height:100vh;height:100dvh;display:flex;flex-direction:column;">
      ${deskNav()}
      ${deskGamesScreen()}
    </div>
    ${videoModalHtml()}`;
  } else if (S.isDesk) {
    const T = theme();
    html = `
    <div style="height:100vh;height:100dvh;display:flex;flex-direction:column;">
      ${deskNav()}
      <div style="flex:1;min-height:0;display:flex;justify-content:center;padding:22px 16px;">
        <div class="bo-col" style="background:${T.th.surface};border-radius:14px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.06);display:flex;flex-direction:column;min-height:0;">
          ${topBar()}
          <div class="scrl" id="bo-content" style="flex:1;overflow-y:auto;overflow-x:hidden;position:relative;">${screenHtml()}</div>
        </div>
      </div>
    </div>
    ${videoModalHtml()}`;
  } else {
    const T = theme();
    html = `
    <div class="bo-col" style="height:100vh;height:100dvh;background:${T.th.surface};overflow:hidden;position:relative;display:flex;flex-direction:column;">
      ${topBar()}
      <div class="scrl" id="bo-content" style="flex:1;overflow-y:auto;overflow-x:hidden;position:relative;">${screenHtml()}</div>
      ${tabBar()}
    </div>
    ${videoModalHtml()}`;
  }

  app.innerHTML = html;
  lastRenderedRoute = screenKey;

  const content = document.getElementById('bo-content');
  if (content) content.scrollTop = sameScreen ? prevScroll : 0;
  const adm = document.getElementById('bo-adm-content');
  if (adm) adm.scrollTop = sameScreen ? prevAdmScroll : 0;
  if (!content && !adm && sameScreen) window.scrollTo(0, prevWin);

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) {
        try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* ok */ }
      }
    }
  }
}

/* ════════════════════ routing ════════════════════ */
const ROUTES = ['home', 'games', 'game', 'schedule', 'tribes', 'score', 'immunity', 'dip', 'dip-vote', 'relay', 'admin'];
function parseRoute() {
  const h = location.hash || '#/home';
  const m = h.match(/^#\/([\w-]+)(?:\/(.+))?/);
  let r = m ? m[1] : 'home';
  if (!ROUTES.includes(r)) r = 'home';
  const prev = S.route + '/' + (S.routeArg || '');
  S.route = r;
  S.routeArg = m && m[2] ? decodeURIComponent(m[2]) : null;
  if (prev !== S.route + '/' + (S.routeArg || '')) {
    S.videoOpen = null;
    S.adminConfirmReveal = false;
    S.editingId = null;
  }
  if (S.route === 'admin' && S.token && S.boot && S.boot.user.isAdmin && !S.overview) loadOverview(true);
}
window.addEventListener('hashchange', () => { parseRoute(); render(); });
window.addEventListener('resize', () => {
  const d = window.innerWidth >= 940;
  if (d !== S.isDesk) { S.isDesk = d; render(); }
});

/* ════════════════════ actions ════════════════════ */
async function guarded(fn) {
  if (S.busy) return;
  S.busy = true;
  try { await fn(); }
  catch (e) { if (e.code !== 'expired') toast(e.message); render(); }
  S.busy = false;
}
async function afterAdminMutation() {
  await loadOverview(true);
  loadBoot(true);   // settings/event-mode changes affect the player app too
}
function collectAuthErrorReset() { S.inErr = false; S.pwErr = false; S.rcErr = false; S.authMsg = null; }

const ACTIONS = {
  // ── navigation ──
  go: (el) => { location.hash = '#/' + el.dataset.to; },
  openGame: (el) => { location.hash = '#/game/' + encodeURIComponent(el.dataset.id); },
  retryBoot: () => loadBoot(),
  signOut: () => {
    setToken(null); S.boot = null; S.overview = null; S.forceTeamGate = false;
    S.authView = 'signin'; collectAuthErrorReset();
    S.f.inPass = ''; S.f.npPass = ''; S.f.npPass2 = ''; S.f.rlPass = ''; S.f.rcPass = '';
    location.hash = '#/home';
    render();
  },
  changeTribe: () => { S.forceTeamGate = true; render(); },

  // ── auth ──
  authView: (el) => { S.authView = el.dataset.view; collectAuthErrorReset(); render(); },
  refMode: (el) => { S.refMode = el.dataset.mode; collectAuthErrorReset(); render(); },
  pickSignupTeam: (el) => { S.signupTeam = el.dataset.team; render(); },
  doSignIn: () => guarded(async () => {
    collectAuthErrorReset();
    const email = (S.f.inEmail || '').trim(), pass = S.f.inPass || '';
    if (!email || !pass) { S.inErr = true; render(); return; }
    try {
      const res = await api('/auth/signin', { method: 'POST', body: { email, password: pass } });
      setToken(res.token); S.f.inPass = '';
      location.hash = '#/home';
      await loadBoot();
    } catch (e) {
      if (e.code === 'expired') throw e;
      S.authMsg = e.message; render();
    }
  }),
  doSignUp: () => guarded(async () => {
    collectAuthErrorReset();
    const f = S.f;
    if (!(f.npFirst || '').trim() || !(f.npLast || '').trim() || !(f.npEmail || '').trim() || !(f.npPass || '')) {
      S.inErr = true; render(); return;
    }
    if (f.npPass !== f.npPass2) { S.pwErr = true; render(); return; }
    try {
      const res = await api('/auth/signup', {
        method: 'POST',
        body: {
          firstName: f.npFirst.trim(), lastName: f.npLast.trim(), email: f.npEmail.trim(),
          password: f.npPass, team: S.signupTeam || 'buffalo',
          shirtSize: f.npShirt || 'M', years: f.npYears || '1st', songRequest: (f.npSong || '').trim(),
        },
      });
      setToken(res.token); S.f.npPass = ''; S.f.npPass2 = '';
      location.hash = '#/home';
      await loadBoot();
    } catch (e) {
      if (e.code === 'expired') throw e;
      S.authMsg = e.message; render();
    }
  }),
  refLogin: () => guarded(async () => {
    collectAuthErrorReset();
    const u = (S.f.rlUser || '').trim(), p = S.f.rlPass || '';
    if (!u || !p) { S.inErr = true; render(); return; }
    try {
      const res = await api('/auth/ref-login', { method: 'POST', body: { username: u, password: p } });
      setToken(res.token); S.f.rlPass = '';
      location.hash = '#/home';
      await loadBoot();
    } catch (e) {
      if (e.code === 'expired') throw e;
      S.authMsg = e.message; render();
    }
  }),
  refCreate: () => guarded(async () => {
    collectAuthErrorReset();
    const u = (S.f.rcUser || '').trim(), p = S.f.rcPass || '', code = (S.f.rcCode || '').trim();
    if (!u || !p) { S.inErr = true; render(); return; }
    try {
      const res = await api('/auth/ref-create', { method: 'POST', body: { username: u, password: p, joinCode: code } });
      setToken(res.token); S.f.rcPass = '';
      location.hash = '#/home';
      await loadBoot();
    } catch (e) {
      if (e.code === 'expired') throw e;
      if (e.code === 'bad_code') { S.rcErr = true; render(); return; }
      S.authMsg = e.message; render();
    }
  }),
  gateTeam: (el) => guarded(async () => {
    await api('/me/team', { method: 'POST', body: { team: el.dataset.team } });
    S.forceTeamGate = false;
    await loadBoot(true);
  }),

  // ── games ──
  setCat: (el) => { S.cat = el.dataset.cat; render(); },
  clearSearch: () => { S.gameSearch = ''; render(); },
  toggleWalkup: () => { S.walkupOpen = !S.walkupOpen; render(); },
  joinSlot: (el) => guarded(async () => {
    const body = { slotId: parseInt(el.dataset.slot, 10) };
    if (el.dataset.teamno) body.teamNo = parseInt(el.dataset.teamno, 10);   // team games (migration 011)
    const res = await api('/signups', { method: 'POST', body });
    applyBoot(res); toast("You're in!");
  }),
  leaveSlot: (el) => guarded(async () => {
    const res = await api('/signups/' + encodeURIComponent(el.dataset.slot), { method: 'DELETE' });
    applyBoot(res); toast('Spot cancelled');
  }),
  openVideo: (el) => {
    const g = (S.boot.games || []).find(x => x.id === el.dataset.id);
    if (!g) return;
    S.videoOpen = g.videoUrl || ('https://www.youtube.com/results?search_query=' + encodeURIComponent('how to play ' + g.name));
    render();
  },
  closeVideo: () => { S.videoOpen = null; render(); },

  // ── tribes ──
  tribeTab: (el) => { S.tribeTab = el.dataset.tab; render(); },

  // ── dip ──
  dipEnter: () => guarded(async () => {
    const res = await api('/dip', { method: 'POST', body: { action: 'enter' } });
    applyBoot(res); toast("You're on the cook list");
  }),
  dipLeave: () => guarded(async () => {
    const res = await api('/dip', { method: 'POST', body: { action: 'leave' } });
    applyBoot(res); toast('Dropped out of the Dip Off');
  }),
  dipVote: (el) => guarded(async () => {
    const res = await api('/dip/vote', { method: 'POST', body: { entryId: parseInt(el.dataset.id, 10) } });
    applyBoot(res); toast('Vote cast');
  }),

  // ── relay ──
  relayJoin: (el) => guarded(async () => {
    const res = await api('/relay', { method: 'POST', body: { legId: el.dataset.id } });
    applyBoot(res); toast("You're on the leg");
  }),
  relayLeave: () => guarded(async () => {
    const res = await api('/relay', { method: 'DELETE' });
    applyBoot(res); toast('Left the relay');
  }),

  // ── ref board ──
  refToggle: (el) => {
    const id = el.dataset.id;
    if (S.refOpen === id) S.refOpen = null;
    else {
      S.refOpen = id;
      S.entryB = 0; S.entryR = 0; S.walkSearch = ''; S.walkPick = null; S.walkScore = 0;
      S.refWinner = null; S.refRound = 'round'; S.refRoundSel = null; S.teamScores = {}; S.soloScores = {};
      S.mu = { buffalo: [], roadhouse: [] }; S.muSearch = { buffalo: '', roadhouse: '' }; S.muScores = {}; S.muWinner = null;
    }
    render();
  },
  refSelectSlot: (el) => { S.refSlot[el.dataset.game] = parseInt(el.dataset.slot, 10); S.refWinner = null; S.teamScores = {}; S.soloScores = {}; render(); },
  // ── walk-up matchup builder ──
  muPick: (el) => {
    const t = el.dataset.team;
    if (!S.mu[t]) S.mu[t] = [];
    if (!S.mu[t].includes(el.dataset.name)) S.mu[t].push(el.dataset.name);
    S.muSearch[t] = '';
    render();
  },
  muDrop: (el) => {
    const t = el.dataset.team;
    S.mu[t] = (S.mu[t] || []).filter(n => n !== el.dataset.name);
    S.muWinner = null;
    render();
  },
  muWinner: (el) => { S.muWinner = el.dataset.team; render(); },
  muSubmit: (el) => guarded(async () => {
    const st = (S.boot.refStations || []).find(x => x.gameId === el.dataset.game);
    if (!st) return;
    const bufNames = (S.mu.buffalo || []).join(' & ');
    const roadNames = (S.mu.roadhouse || []).join(' & ');
    if (st.type === 'vs') {
      if (!S.muWinner) { toast('Tap the winning side first'); return; }
      await api('/results', { method: 'POST', body: {
        type: 'winner', gameName: st.name,
        winnerTeam: S.muWinner, winnerName: S.muWinner === 'buffalo' ? bufNames : roadNames,
        scores: true, slotLabel: 'Walk-up',
      } });
    } else {
      const entries = [
        { name: bufNames, team: 'buffalo', score: S.muScores.buffalo || 0 },
        { name: roadNames, team: 'roadhouse', score: S.muScores.roadhouse || 0 },
      ].filter(e => e.name && e.score > 0);
      if (!entries.length) { toast('Enter a score for at least one side'); return; }
      await api('/results', { method: 'POST', body: { type: 'solo', gameName: st.name, entries, slotLabel: 'Walk-up' } });
    }
    S.mu = { buffalo: [], roadhouse: [] }; S.muSearch = { buffalo: '', roadhouse: '' }; S.muScores = {}; S.muWinner = null;
    toast('Matchup logged');
    loadBoot(true);
  }),
  // ── structured bracket match (migration 012) ──
  refBracketSubmit: (el) => guarded(async () => {
    const w = S.refWinner;
    if (!w) { toast('Tap the winner first'); return; }
    const st = (S.boot.refStations || []).find(x => x.gameId === el.dataset.game);
    const slotId = parseInt(el.dataset.slot, 10);
    const slot = st ? (st.slots || []).find(s => s.id === slotId) : null;
    const isFinal = el.dataset.stage === 'champ';
    await api('/results', { method: 'POST', body: {
      type: 'winner', gameName: st ? st.name : el.dataset.game,
      winnerTeam: w.team, winnerName: w.name,
      scores: isFinal, stage: isFinal ? 'champ' : 'round',
      slotId, slotLabel: slot ? slot.label : null,
      roundLabel: el.dataset.roundlabel || null,
    } });
    S.refWinner = null;
    toast(isFinal ? 'Champion logged & scored' : 'Winner logged — the next round fills in');
    loadBoot(true);
  }),
  refClaim: (el) => guarded(async () => {
    const claim = el.dataset.claim === '1';
    const res = await api('/ref-claim', { method: 'POST', body: { gameId: el.dataset.game, claim } });
    applyBoot(res);
    toast(claim ? "You're reffing it" : 'Released');
  }),
  refRound: (el) => { S.refRound = el.dataset.round; S.refWinner = null; render(); },
  refRoundPick: (el) => { S.refRoundSel = el.dataset.round; S.refWinner = null; render(); },
  refPickWinner: (el) => {
    S.refWinner = {
      team: el.dataset.team, name: el.dataset.name,
      key: el.dataset.key || (el.dataset.team + ':' + el.dataset.name),
      scores: el.dataset.scores === '1',
    };
    render();
  },
  refWinnerSubmit: (el) => guarded(async () => {
    const w = S.refWinner;
    if (!w) { toast('Tap the winner first'); return; }
    const st = (S.boot.refStations || []).find(x => x.gameId === el.dataset.game);
    // Tag the result to the slot + bracket round being scored so it shows a
    // green "Scored" mark (and the next round populates on the round list).
    const selId = S.refSlot[el.dataset.game];
    const slot = st ? (st.slots || []).find(s => String(s.id) === String(selId)) : null;
    const isBracket = st && (st.isBracket !== undefined ? st.isBracket : !!BRACKETS[st.gameId]);
    const brData = st && ((st.bracket && (st.bracket.rounds || []).length) ? st.bracket : (BRACKETS[st.gameId] || null));
    const round = isBracket ? (S.refRound || 'round') : 'champ';
    let roundLabel = null;
    if (isBracket && brData) {
      if (round === 'round') {
        const names = brData.rounds.filter(r => r.team !== 'final').map(r => r.name);
        roundLabel = names.includes(S.refRoundSel) ? S.refRoundSel : (names[0] || 'Bracket round');
      } else {
        roundLabel = ((brData.rounds || []).find(r => r.team === 'final') || {}).name || 'Championship';
      }
    }
    await api('/results', { method: 'POST', body: {
      type: 'winner', gameName: st ? st.name : el.dataset.game,
      winnerTeam: w.team, winnerName: w.name, scores: !!w.scores,
      stage: round === 'round' ? 'round' : 'champ',
      slotId: slot ? slot.id : null, slotLabel: slot ? slot.label : null, roundLabel,
    } });
    S.refWinner = null;
    toast(round === 'round' ? 'Winner logged — they advance' : 'Winner logged & scored');
    loadBoot(true);
  }),
  refVsSubmit: (el) => guarded(async () => {
    const st = (S.boot.refStations || []).find(x => x.gameId === el.dataset.game);
    if (!st) return;
    const b = S.teamScores.buffalo || 0, r = S.teamScores.roadhouse || 0;
    if (!b && !r) { toast('Enter a score for at least one team'); return; }
    const selId = S.refSlot[el.dataset.game];
    const slot = (st.slots || []).find(s => String(s.id) === String(selId));
    await api('/results', { method: 'POST', body: {
      type: 'vs', gameName: st.name, ptsBuffalo: b, ptsRoadhouse: r,
      slotId: slot ? slot.id : null, slotLabel: slot ? slot.label : null,
    } });
    S.teamScores = {};
    toast('Team scores logged');
    loadBoot(true);
  }),
  refSoloSubmit: (el) => guarded(async () => {
    // Non-head-to-head slot — log one result per player who has a score.
    const st = (S.boot.refStations || []).find(x => x.gameId === el.dataset.game);
    if (!st) return;
    const selId = S.refSlot[el.dataset.game];
    const slot = (st.slots || []).find(s => String(s.id) === String(selId));
    if (!slot) { toast('Pick a timeslot first'); return; }
    const people = [
      ...((slot.buffalo || []).map(n => ({ name: n, team: 'buffalo' }))),
      ...((slot.roadhouse || []).map(n => ({ name: n, team: 'roadhouse' }))),
    ];
    const entries = people
      .map(p => ({ name: p.name, team: p.team, score: S.soloScores[p.name] || 0 }))
      .filter(e => e.score > 0);
    if (!entries.length) { toast('Enter a score for at least one player'); return; }
    await api('/results', { method: 'POST', body: {
      type: 'solo', gameName: st.name, entries, slotId: slot.id, slotLabel: slot.label,
    } });
    S.soloScores = {};
    toast('Scores logged');
    loadBoot(true);
  }),
  refChangeResult: (el) => {
    const ids = String(el.dataset.ids || '').split(',').map(x => parseInt(x, 10)).filter(Number.isInteger);
    if (!ids.length) return;
    if (!window.confirm('⚠️ Change this result?\n\nThe logged entry (and its points) will be removed so you can re-enter it. Do this only if it was scored wrong.')) return;
    guarded(async () => {
      for (const id of ids) await api('/results/' + id, { method: 'DELETE' });
      S.refWinner = null; S.teamScores = {}; S.soloScores = {};
      toast('Result removed — enter the correct one now');
      await loadBoot(true);
    });
  },
  walkPick: (el) => { S.walkPick = { name: el.dataset.name, team: el.dataset.team }; S.walkSearch = el.dataset.name; S.walkScore = 0; render(); },
  walkSubmit: (el) => guarded(async () => {
    if (!S.walkPick) return;
    if (!S.walkScore) { toast('Add a score first'); return; }
    const st = (S.boot.refStations || []).find(x => x.gameId === el.dataset.game);
    await api('/results', {
      method: 'POST',
      body: { type: 'walk', gameName: st ? st.name : el.dataset.game, playerName: S.walkPick.name, team: S.walkPick.team, score: S.walkScore },
    });
    S.walkLog.unshift({ name: S.walkPick.name, score: S.walkScore });
    S.walkPick = null; S.walkScore = 0; S.walkSearch = '';
    toast('Logged');
    loadBoot(true);
  }),

  // ── admin ──
  admSection: (el) => { S.adminSection = el.dataset.id; S.adminConfirmReveal = false; S.editingId = null; S.admSchedEdit = null; S.admIdolEdit = null; S.admIdolAward = null; S.admFillSlot = null; S.admAddSlot = null; S.admBracketEdit = null; render(); },
  admMode: (el) => guarded(async () => {
    await api('/ac/settings', { method: 'POST', body: { eventMode: el.dataset.mode } });
    await afterAdminMutation();
    toast(el.dataset.mode === 'gameday' ? 'Game Day is live' : 'Back to sign-up mode');
  }),
  admToggle: (el) => guarded(async () => {
    await api('/ac/people', { method: 'POST', body: { userId: parseInt(el.dataset.uid, 10), action: el.dataset.flag } });
    await loadOverview(true);
  }),
  admRemoveGame: (el) => guarded(async () => {
    await api('/ac/people', { method: 'POST', body: { userId: parseInt(el.dataset.uid, 10), action: 'removeGame', gameId: el.dataset.gid } });
    await loadOverview(true);
  }),
  admResetPw: (el) => {
    const name = el.dataset.name || 'this person';
    const pw = window.prompt(`Set a new password for ${name}.\nThey'll sign in with it and can keep using it. Tell them in person.`, '');
    if (pw === null) return;                 // cancelled
    if (pw.trim().length < 4) { toast('Password must be at least 4 characters'); return; }
    guarded(async () => {
      await api('/ac/people', { method: 'POST', body: { userId: parseInt(el.dataset.uid, 10), action: 'resetPassword', password: pw } });
      toast(`Password reset for ${name}`);
    });
  },
  admRemoveUser: (el) => {
    const name = el.dataset.name || 'this person';
    if (!window.confirm(`Delete ${name}? This removes their account and all their sign-ups, dip & relay entries. This can't be undone.`)) return;
    guarded(async () => {
      await api('/ac/people', { method: 'POST', body: { userId: parseInt(el.dataset.uid, 10), action: 'removeUser' } });
      await loadOverview(true);
      toast(`${name} removed`);
    });
  },
  admExportSongs: () => {
    const ov = S.overview;
    if (!ov) return;
    const teamLabel = (t) => t === 'roadhouse' ? 'Texas Roadhouse' : (t === 'buffalo' ? 'Buffalo' : '');
    const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['Name', 'Team', 'Song request'].map(csvCell).join(',')];
    (ov.people || [])
      .filter(p => p.songRequest && p.songRequest.trim())
      .forEach(p => lines.push([p.name, teamLabel(p.team), p.songRequest.trim()].map(csvCell).join(',')));
    if (lines.length < 2) { toast('No song requests to export yet'); return; }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'buff-olympics-song-requests.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Song list exported');
  },
  admSchedAdd: () => guarded(async () => {
    await api('/ac/schedule', { method: 'POST', body: { action: 'add' } });
    await loadOverview(true);
    // Open the freshly-added block for editing (it sorts to the end).
    const rows = (S.overview && S.overview.schedule) || [];
    const last = rows[rows.length - 1];
    if (last) {
      S.admSchedEdit = last.id; S.admSchedKind = last.kind || 'up';
      S.f.schTime = `${last.timeLabel} ${last.ampm}`; S.f.schTitle = last.title || ''; S.f.schPlace = last.place || '';
      S.f.schEnd = last.endLabel ? `${last.endLabel} ${last.endAmpm}` : '';
    }
    render();
  }),
  admSchedEdit: (el) => {
    const id = parseInt(el.dataset.id, 10);
    const e = ((S.overview && S.overview.schedule) || []).find(x => x.id === id);
    if (!e) return;
    S.admSchedEdit = id; S.admSchedKind = e.kind || 'up';
    S.f.schTime = `${e.timeLabel} ${e.ampm}`; S.f.schTitle = e.title || ''; S.f.schPlace = e.place || '';
    S.f.schEnd = e.endLabel ? `${e.endLabel} ${e.endAmpm}` : '';
    render();
  },
  admSchedKind: (el) => { S.admSchedKind = el.dataset.kind; render(); },
  admSchedCancel: () => { S.admSchedEdit = null; render(); },
  admSchedSave: (el) => guarded(async () => {
    const id = parseInt(el.dataset.id, 10);
    const min = parseTimeLabel((S.f.schTime || '').trim());
    if (min === null) { toast('Enter a time like 8:00 AM'); return; }
    const full = minToLabel(min);
    const sp = full.lastIndexOf(' ');
    const title = (S.f.schTitle || '').trim();
    if (!title) { toast('Give the block a title'); return; }
    // Optional end time.
    let endLabel = '', endAmpm = '';
    const endStr = (S.f.schEnd || '').trim();
    if (endStr) {
      const emin = parseTimeLabel(endStr);
      if (emin === null) { toast('Enter an end time like 9:00 AM, or leave it blank'); return; }
      const efull = minToLabel(emin), esp = efull.lastIndexOf(' ');
      endLabel = efull.slice(0, esp); endAmpm = efull.slice(esp + 1);
    }
    await api('/ac/schedule', { method: 'POST', body: {
      action: 'update', id,
      timeLabel: full.slice(0, sp), ampm: full.slice(sp + 1),
      title, place: (S.f.schPlace || '').trim(), kind: S.admSchedKind || 'up',
      endLabel, endAmpm,
    } });
    S.admSchedEdit = null;
    await loadOverview(true);
    toast('Schedule updated');
  }),
  admIdolAdd: () => guarded(async () => {
    await api('/ac/idols', { method: 'POST', body: { action: 'add' } });
    await loadOverview(true);
    const rows = (S.overview && S.overview.idols) || [];
    const last = rows[rows.length - 1];
    if (last) {
      S.admIdolEdit = last.id;
      S.f.idTitle = last.title || ''; S.f.idClue = last.clue || '';
      S.f.idTime = last.releaseMin != null ? minToLabel(last.releaseMin) : '';
      S.f.idPoints = last.points != null ? String(last.points) : '';
    }
    render();
  }),
  admIdolEdit: (el) => {
    const id = parseInt(el.dataset.id, 10);
    const idol = ((S.overview && S.overview.idols) || []).find(x => x.id === id);
    if (!idol) return;
    S.admIdolEdit = id;
    S.f.idTitle = idol.title || ''; S.f.idClue = idol.clue || '';
    S.f.idTime = idol.releaseMin != null ? minToLabel(idol.releaseMin) : '';
    S.f.idPoints = idol.points != null ? String(idol.points) : '';
    render();
  },
  admIdolCancel: () => { S.admIdolEdit = null; render(); },
  admIdolSave: (el) => guarded(async () => {
    const id = parseInt(el.dataset.id, 10);
    const timeStr = (S.f.idTime || '').trim();
    let releaseMin = null;
    if (timeStr) {
      releaseMin = parseTimeLabel(timeStr);
      if (releaseMin === null) { toast('Enter a time like 1:30 PM, or leave it blank'); return; }
    }
    await api('/ac/idols', { method: 'POST', body: {
      action: 'update', id,
      title: (S.f.idTitle || '').trim(), clue: (S.f.idClue || '').trim(), releaseMin,
      points: Math.max(0, parseInt(S.f.idPoints, 10) || 0),
    } });
    S.admIdolEdit = null;
    await loadOverview(true);
    toast('Clue saved');
  }),
  admIdolFound: (el) => guarded(async () => {
    await api('/ac/idols', { method: 'POST', body: { action: 'toggleFound', id: parseInt(el.dataset.id, 10) } });
    await loadOverview(true);
  }),
  admIdolAwardOpen: (el) => { S.admIdolAward = parseInt(el.dataset.id, 10); S.f.admIdolSearch = ''; render(); },
  admIdolAwardCancel: () => { S.admIdolAward = null; S.f.admIdolSearch = ''; render(); },
  admIdolAwardPick: (el) => {
    const name = el.dataset.name || 'this person';
    if (!window.confirm(`Award this idol to ${name}? Their tribe gets the idol's points and the entry shows in Scores.`)) return;
    guarded(async () => {
      await api('/ac/idols', { method: 'POST', body: { action: 'award', id: parseInt(el.dataset.id, 10), userId: parseInt(el.dataset.uid, 10) } });
      S.admIdolAward = null; S.f.admIdolSearch = '';
      await afterAdminMutation();
      toast(`Idol awarded to ${name}`);
    });
  },
  admIdolDelete: (el) => {
    if (!window.confirm(`Delete ${el.dataset.title}? This can't be undone.`)) return;
    guarded(async () => {
      await api('/ac/idols', { method: 'POST', body: { action: 'remove', id: parseInt(el.dataset.id, 10) } });
      await loadOverview(true);
      toast('Clue deleted');
    });
  },
  admSchedMove: (el) => guarded(async () => {
    await api('/ac/schedule', { method: 'POST', body: { action: 'move', id: parseInt(el.dataset.id, 10), dir: parseInt(el.dataset.dir, 10) } });
    await loadOverview(true);
  }),
  admSchedRemove: (el) => guarded(async () => {
    await api('/ac/schedule', { method: 'POST', body: { action: 'remove', id: parseInt(el.dataset.id, 10) } });
    await loadOverview(true);
  }),
  admSchedView: (el) => { S.schedView = el.dataset.view; render(); },

  // ── games & slots editor ──
  admNoop: () => {},
  admGameNew: () => {
    S.admGameEdit = { mode: 'add', needsRef: true, openPlay: false, headToHead: true };
    S.f.gmName = ''; S.f.gmTime = ''; S.f.gmVenue = ''; S.f.gmPoints = '10';
    S.f.gmPlayers = ''; S.f.gmPointsLabel = ''; S.f.gmDescr = ''; S.f.gmVideo = ''; S.f.gmTeamSize = '1';
    render();
  },
  admGameEdit: (el) => {
    const g = (S.overview.gamesCatalog || []).find(x => x.id === el.dataset.id);
    if (!g) return;
    S.admGameEdit = {
      mode: 'edit', id: g.id, needsRef: !!g.needsRef, openPlay: !!g.openPlay,
      headToHead: g.headToHead !== undefined ? !!g.headToHead : !g.openPlay,
    };
    S.f.gmName = g.name; S.f.gmTime = g.runtimeLabel || ''; S.f.gmVenue = g.venue || '';
    S.f.gmPoints = String(g.winPoints != null ? g.winPoints : 10);
    S.f.gmPlayers = g.players || ''; S.f.gmPointsLabel = g.pointsLabel || '';
    S.f.gmDescr = g.descr || ''; S.f.gmVideo = g.videoUrl || '';
    S.f.gmTeamSize = String(g.teamSize != null ? g.teamSize : 1);
    render();
  },
  // ── Bracket Builder matches (migration 012) ──
  admMatchEditStart: (el) => {
    S.admMatchEdit = parseInt(el.dataset.slot, 10);
    S.f.bmTime = el.dataset.time || '';
    S.f.bmRound = el.dataset.round || '';
    S.f.bmLane = el.dataset.lane || '';
    render();
  },
  admMatchLanePick: (el) => { S.f.bmLane = S.f.bmLane === el.dataset.lane ? '' : el.dataset.lane; render(); },
  admMatchCancel: () => { S.admMatchEdit = null; render(); },
  admMatchSave: (el) => guarded(async () => {
    const slotId = parseInt(el.dataset.slot, 10);
    const startMin = parseTimeLabel(S.f.bmTime || '');
    if (startMin === null) { toast('Enter a time like 2:30 PM'); return; }
    const rn = parseInt(S.f.bmRound, 10);
    await api('/ac/games', { method: 'POST', body: {
      action: 'updateSlot', slotId,
      startMin, label: minToLabel(startMin),
      roundNo: Number.isInteger(rn) && rn > 0 ? rn : null,
      lane: S.f.bmLane || null,
    } });
    S.admMatchEdit = null;
    await loadOverview(true);
    toast('Match updated');
  }),
  admMatchAdd: (el) => guarded(async () => {
    const gameId = el.dataset.game;
    const round = parseInt(el.dataset.round, 10) || 1;
    const lane = el.dataset.lane;
    const g = (S.overview.gamesCatalog || []).find(x => x.id === gameId) || {};
    const ts = (g.teamSize && g.teamSize >= 2) ? g.teamSize : 1;
    // Round-1 matches take sign-ups (2 units of team size); later rounds and
    // the championship auto-fill from winners, so they hold no sign-up seats.
    const seed = round === 1 && lane !== 'final';
    const capBuffalo = seed && lane === 'buffalo' ? ts * 2 : 0;
    const capRoadhouse = seed && lane === 'roadhouse' ? ts * 2 : 0;
    const slots = (g.slots || []).slice().sort((a, b) => a.startMin - b.startMin);
    const startMin = slots.length ? slots[slots.length - 1].startMin + 30 : 720;
    await api('/ac/games', { method: 'POST', body: {
      action: 'addSlot', gameId, startMin, label: minToLabel(startMin),
      capBuffalo, capRoadhouse, roundNo: round, lane,
    } });
    await loadOverview(true);
    toast(lane === 'final' ? 'Championship added — set its time via Edit' : `Round ${round} match added — set its time via Edit`);
  }),
  admMatchRemove: (el) => {
    const signed = parseInt(el.dataset.signed, 10) || 0;
    const msg = signed > 0
      ? `Remove this match? ${signed} sign-up${signed === 1 ? '' : 's'} will be removed with it.`
      : 'Remove this match?';
    if (!window.confirm(msg)) return;
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'removeSlot', slotId: parseInt(el.dataset.slot, 10) } });
      await loadOverview(true);
      toast('Match removed');
    });
  },
  admGameFlagRef: () => { if (S.admGameEdit) { S.admGameEdit.needsRef = !S.admGameEdit.needsRef; render(); } },
  admGameFlagWalk: () => { if (S.admGameEdit) { S.admGameEdit.openPlay = !S.admGameEdit.openPlay; render(); } },
  admGameFlagH2H: () => { if (S.admGameEdit) { S.admGameEdit.headToHead = !S.admGameEdit.headToHead; render(); } },
  // ── bracket editor ──
  admBracketOpen: (el) => {
    S.admBracketEdit = { gameId: el.dataset.id };
    S.admRoundEdit = null;
    S.admMatchEdit = null;
    const g = (S.overview.gamesCatalog || []).find(x => x.id === el.dataset.id);
    S.f.brIntro = g ? (g.bracketIntro || '') : '';
    S.f.brRoundPts = g ? String(g.roundPoints || 0) : '0';
    render();
  },
  admBracketClose: () => { S.admBracketEdit = null; S.admRoundEdit = null; render(); },
  admBracketToggle: () => {
    const be = S.admBracketEdit; if (!be) return;
    const g = (S.overview.gamesCatalog || []).find(x => x.id === be.gameId);
    const next = !(g && g.isBracket);
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'updateGame', gameId: be.gameId, isBracket: next } });
      await loadOverview(true);
      toast(next ? 'Marked as a bracket game' : 'No longer a bracket game');
    });
  },
  admBracketPointsSave: () => {
    const be = S.admBracketEdit; if (!be) return;
    const rp = Math.max(0, parseInt(S.f.brRoundPts, 10) || 0);
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'updateGame', gameId: be.gameId, roundPoints: rp } });
      await loadOverview(true);
      toast(rp > 0 ? `Round wins now earn ${rp} pts` : 'Rounds are advancement-only');
    });
  },
  admBracketIntroSave: () => {
    const be = S.admBracketEdit; if (!be) return;
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'updateGame', gameId: be.gameId, bracketIntro: (S.f.brIntro || '').trim() } });
      await loadOverview(true);
      toast('Intro saved');
    });
  },
  admRoundAdd: (el) => guarded(async () => {
    await api('/ac/games', { method: 'POST', body: { action: 'addRound', gameId: el.dataset.game } });
    await loadOverview(true);
  }),
  admRoundEditStart: (el) => {
    S.admRoundEdit = parseInt(el.dataset.round, 10);
    S.f.brTime = el.dataset.time || ''; S.f.brName = el.dataset.name || '';
    S.f.brDetail = el.dataset.detail || ''; S.admRoundTeam = el.dataset.team || 'both';
    render();
  },
  admRoundTeamPick: (el) => { S.admRoundTeam = el.dataset.team; render(); },
  admRoundCancel: () => { S.admRoundEdit = null; render(); },
  admRoundSave: (el) => guarded(async () => {
    await api('/ac/games', { method: 'POST', body: {
      action: 'updateRound', roundId: parseInt(el.dataset.round, 10),
      timeLabel: (S.f.brTime || '').trim(), name: (S.f.brName || '').trim(),
      detail: (S.f.brDetail || '').trim(), team: S.admRoundTeam || 'both',
    } });
    S.admRoundEdit = null;
    await loadOverview(true);
    toast('Round saved');
  }),
  admRoundRemove: (el) => {
    if (!window.confirm('Remove this round?')) return;
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'removeRound', roundId: parseInt(el.dataset.round, 10) } });
      await loadOverview(true);
    });
  },
  admGameCancel: () => { S.admGameEdit = null; render(); },
  admGameSave: () => guarded(async () => {
    const ge = S.admGameEdit; if (!ge) return;
    const name = (S.f.gmName || '').trim();
    if (!name) { toast('Give the game a name'); return; }
    const wp = Math.max(0, parseInt(S.f.gmPoints, 10) || 0);
    const ts = Math.max(1, parseInt(S.f.gmTeamSize, 10) || 1);
    const details = {
      winPoints: wp,
      teamSize: ts,
      players: (S.f.gmPlayers || '').trim(),
      pointsLabel: (S.f.gmPointsLabel || '').trim(),
      descr: (S.f.gmDescr || '').trim(),
      videoUrl: (S.f.gmVideo || '').trim(),
    };
    const body = {
      name, timeLabel: (S.f.gmTime || '').trim(), venue: (S.f.gmVenue || '').trim(),
      needsRef: !!ge.needsRef, openPlay: !!ge.openPlay,
    };
    details.headToHead = !!ge.headToHead;
    let upRes = null;
    if (ge.mode === 'add') {
      // addGame inserts the core row (text fields default NULL); set the pills /
      // how-to-play / video / win-points in a follow-up updateGame.
      body.action = 'addGame';
      const res = await api('/ac/games', { method: 'POST', body });
      if (res && res.id) {
        upRes = await api('/ac/games', { method: 'POST', body: { action: 'updateGame', gameId: res.id, ...details } });
      }
    } else {
      upRes = await api('/ac/games', { method: 'POST', body: { action: 'updateGame', gameId: ge.id, ...body, ...details } });
    }
    S.admGameEdit = null;
    await loadOverview(true);
    // Team size can't be stored until migration 011 is run — say so clearly
    // rather than letting the save look successful when it didn't take.
    if (ts >= 2 && upRes && upRes.teamSizeSaved === false) {
      toast('Saved — but team size needs migration 011 (run it in Fabric, then set team size again).');
    } else {
      toast(ge.mode === 'add' ? 'Game added' : 'Game updated');
    }
  }),
  admGameDelete: (el) => {
    const signed = parseInt(el.dataset.signed, 10) || 0;
    const msg = signed > 0
      ? `Delete “${el.dataset.name}”? ${signed} sign-up${signed === 1 ? '' : 's'} will be removed.`
      : `Delete “${el.dataset.name}”?`;
    if (!window.confirm(msg)) return;
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'removeGame', gameId: el.dataset.id } });
      await loadOverview(true);
      toast('Game deleted');
    });
  },
  admSlotNew: (el) => {
    const g = (S.overview.gamesCatalog || []).find(x => x.id === el.dataset.game) || {};
    const ts = (g.teamSize && g.teamSize >= 2) ? g.teamSize : 1;
    S.admSlotEdit = { mode: 'add', gameId: el.dataset.game };
    S.f.slTime = ''; S.f.slCapB = String(ts); S.f.slCapR = String(ts);
    S.f.slTeamsB = '2'; S.f.slTeamsR = '2';
    render();
  },
  admSlotEdit: (el) => {
    const g = (S.overview.gamesCatalog || []).find(x => x.id === el.dataset.game);
    const s = g && (g.slots || []).find(z => String(z.id) === el.dataset.slot);
    if (!s) return;
    const ts = (g.teamSize && g.teamSize >= 2) ? g.teamSize : 1;
    S.admSlotEdit = { mode: 'edit', gameId: el.dataset.game, slotId: s.id };
    S.f.slTime = s.label; S.f.slCapB = String(s.capBuffalo); S.f.slCapR = String(s.capRoadhouse);
    S.f.slTeamsB = String(Math.round((s.capBuffalo || 0) / ts)); S.f.slTeamsR = String(Math.round((s.capRoadhouse || 0) / ts));
    render();
  },
  admSlotCancel: () => { S.admSlotEdit = null; render(); },
  admSlotSave: () => guarded(async () => {
    const se = S.admSlotEdit; if (!se) return;
    const startMin = parseTimeLabel(S.f.slTime || '');
    if (startMin === null) { toast('Enter a time like 1:30 PM'); return; }
    // Team games derive caps from (# teams) × team size; individual games use
    // the raw caps typed in.
    const sg = (S.overview.gamesCatalog || []).find(x => x.id === se.gameId) || {};
    const sts = (sg.teamSize && sg.teamSize >= 2) ? sg.teamSize : 1;
    const capBuffalo = sts >= 2
      ? Math.max(0, parseInt(S.f.slTeamsB, 10) || 0) * sts
      : Math.max(0, parseInt(S.f.slCapB, 10) || 0);
    const capRoadhouse = sts >= 2
      ? Math.max(0, parseInt(S.f.slTeamsR, 10) || 0) * sts
      : Math.max(0, parseInt(S.f.slCapR, 10) || 0);
    const body = {
      startMin, label: minToLabel(startMin),
      capBuffalo, capRoadhouse,
    };
    if (se.mode === 'add') { body.action = 'addSlot'; body.gameId = se.gameId; }
    else { body.action = 'updateSlot'; body.slotId = se.slotId; }
    await api('/ac/games', { method: 'POST', body });
    S.admSlotEdit = null;
    await loadOverview(true);
    toast(se.mode === 'add' ? 'Slot added' : 'Slot updated');
  }),
  admSlotDelete: (el) => {
    const signed = parseInt(el.dataset.signed, 10) || 0;
    const msg = signed > 0
      ? `Delete the ${el.dataset.label} slot? ${signed} sign-up${signed === 1 ? '' : 's'} will be removed.`
      : `Delete the ${el.dataset.label} slot?`;
    if (!window.confirm(msg)) return;
    guarded(async () => {
      await api('/ac/games', { method: 'POST', body: { action: 'removeSlot', slotId: parseInt(el.dataset.slot, 10) } });
      await loadOverview(true);
      toast('Slot deleted');
    });
  },
  admUnfill: (el) => {
    if (!window.confirm(`Remove ${el.dataset.name} from the ${el.dataset.label} slot?`)) return;
    guarded(async () => {
      await api('/ac/people', { method: 'POST', body: { action: 'unfillSlot', userId: parseInt(el.dataset.uid, 10), slotId: parseInt(el.dataset.slot, 10) } });
      await loadOverview(true);
      toast('Removed from the slot');
    });
  },
  admFillOpen: (el) => { S.admFillSlot = { slotId: parseInt(el.dataset.slot, 10), gameId: el.dataset.game }; S.f.admFillSearch = ''; render(); },
  admFillCancel: () => { S.admFillSlot = null; S.f.admFillSearch = ''; render(); },
  admFillPick: (el) => guarded(async () => {
    await api('/ac/people', { method: 'POST', body: { userId: parseInt(el.dataset.uid, 10), action: 'fillSlot', slotId: parseInt(el.dataset.slot, 10) } });
    S.admFillSlot = null; S.f.admFillSearch = '';
    await loadOverview(true);
    toast('Added to the slot');
  }),
  admAddCancel: () => { S.admAddSlot = null; render(); },
  admRefRemove: (el) => guarded(async () => {
    await api('/ac/ref-assign', { method: 'POST', body: { gameId: el.dataset.gid, userId: parseInt(el.dataset.uid, 10), op: 'remove' } });
    await loadOverview(true);
  }),

  admDipReveal: () => guarded(async () => {
    const cur = !!(S.overview && S.overview.dip && S.overview.dip.revealed);
    await api('/ac/settings', { method: 'POST', body: { dipRevealed: !cur } });
    await afterAdminMutation();
  }),
  admDipRemove: (el) => guarded(async () => {
    await api('/ac/dip/' + el.dataset.id, { method: 'DELETE' });
    await afterAdminMutation();
  }),
  admLegCap: (el) => guarded(async () => {
    await api('/ac/relay-legs', { method: 'POST', body: { legId: el.dataset.id, capDelta: parseInt(el.dataset.d, 10) } });
    await loadOverview(true);
  }),
  admPeek: () => guarded(async () => {
    const res = await api('/scores?peek=1');
    S.adminPeek = { buffalo: res.buffalo, roadhouse: res.roadhouse };
    render();
  }),
  admHidePeek: () => { S.adminPeek = null; render(); },
  admAskReveal: () => { S.adminConfirmReveal = true; render(); },
  admCancelReveal: () => { S.adminConfirmReveal = false; render(); },
  admUnreveal: () => {
    if (!window.confirm('Re-seal the scores? The standings disappear from every phone until you Reveal again.')) return;
    guarded(async () => {
      await api('/ac/settings', { method: 'POST', body: { scoresRevealed: false } });
      await loadOverview(true);
      toast('Scores re-sealed');
    });
  },
  admConfirmReveal: () => guarded(async () => {
    await api('/ac/settings', { method: 'POST', body: { scoresRevealed: true } });
    S.adminConfirmReveal = false;
    await afterAdminMutation();
    toast('Scores are live on every phone');
  }),
  admResetScores: () => {
    if (!window.confirm('⚠️ Reset ALL scores?\n\nThis permanently deletes every logged result and its edit history, then re-seals the board. This cannot be undone.\n\nUse only to clear test data before the real event.')) return;
    const pw = window.prompt('Enter the reset password to confirm:');
    if (pw === null) return;
    guarded(async () => {
      await api('/ac/reset-scores', { method: 'POST', body: { confirm: pw } });
      S.adminPeek = null; S.adminConfirmReveal = false;
      await afterAdminMutation();
      toast('All scores cleared');
    });
  },
  admEditStart: (el) => { S.editingId = parseInt(el.dataset.id, 10); S.editVal = el.dataset.pts; S.f.editVal = el.dataset.pts; render(); },
  admEditCancel: () => { S.editingId = null; S.editVal = ''; render(); },
  admEditSave: (el) => guarded(async () => {
    const v = parseInt(S.f.editVal !== undefined ? S.f.editVal : S.editVal, 10);
    if (isNaN(v)) { toast('Enter a number'); return; }
    await api('/ac/results/' + el.dataset.id, { method: 'PATCH', body: { pts: v } });
    S.editingId = null; S.editVal = '';
    await loadOverview(true);
  }),
  admHistory: (el) => {
    const id = parseInt(el.dataset.id, 10);
    S.historyOpenId = S.historyOpenId === id ? null : id;
    render();
  },
  admAnnPush: () => guarded(async () => {
    const title = (S.f.annTitle || '').trim(), body = (S.f.annBody || '').trim();
    if (!title && !body) { toast('Give the announcement a title or a body'); return; }
    await api('/ac/announcements', { method: 'POST', body: { title, body } });
    S.f.annTitle = ''; S.f.annBody = '';
    await afterAdminMutation();
    toast('Pushed to all phones');
  }),
};

const CHANGES = {
  admAddGame: (el) => {
    const gid = el.value;
    if (!gid) return;
    const uid = parseInt(el.dataset.uid, 10);
    el.value = '';
    // Open the time-slot chooser for this person + game (fill via a specific slot).
    S.admAddSlot = { uid, gameId: gid };
    render();
  },
  admAddGameSlot: (el) => {
    const slotId = parseInt(el.value, 10);
    if (!Number.isInteger(slotId)) return;
    const uid = S.admAddSlot ? S.admAddSlot.uid : parseInt(el.dataset.uid, 10);
    S.admAddSlot = null;
    guarded(async () => {
      await api('/ac/people', { method: 'POST', body: { userId: uid, action: 'fillSlot', slotId } });
      await loadOverview(true);
      toast('Added to the slot');
    });
  },
  admRefAssign: (el) => {
    const gid = el.dataset.gid;
    const uid = el.value ? parseInt(el.value, 10) : null;
    if (uid === null) return;
    el.value = '';
    guarded(async () => {
      await api('/ac/ref-assign', { method: 'POST', body: { gameId: gid, userId: uid, op: 'add' } });
      await loadOverview(true);
    });
  },
};

/* debounced live-save inputs (ref join code, relay leg names) */
const debounceTimers = {};
function debounceSave(key, fn) {
  clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(fn, 700);
}

/* ════════════════════ event delegation ════════════════════ */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.field) S.f[el.dataset.field] = el.value;
  // Ref score entry — one number per TEAM. No re-render (keeps the caret in
  // the field); the value is read from state on submit.
  if (el.dataset && el.dataset.teamscore !== undefined) {
    const v = parseInt(el.value, 10);
    S.teamScores[el.dataset.teamscore] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  // Ref score entry — one number per PERSON (non-head-to-head). No re-render.
  if (el.dataset && el.dataset.soloscore !== undefined) {
    const v = parseInt(el.value, 10);
    S.soloScores[el.dataset.soloscore] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  // Walk-up matchup builder — per-side score entry. No re-render.
  if (el.dataset && el.dataset.muscore !== undefined) {
    const v = parseInt(el.value, 10);
    S.muScores[el.dataset.muscore] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  if (el.dataset && el.dataset.walkscore !== undefined) {
    const v = parseInt(el.value, 10);
    S.walkScore = Number.isFinite(v) && v > 0 ? v : 0;
  }
  if (el.dataset && el.dataset.live === 'gameSearch') { S.gameSearch = el.value; render(); }
  if (el.dataset && el.dataset.live === 'walkSearch') { S.walkSearch = el.value; S.walkPick = null; render(); }
  if (el.dataset && el.dataset.live === 'muSearchB') { S.muSearch.buffalo = el.value; render(); }
  if (el.dataset && el.dataset.live === 'muSearchR') { S.muSearch.roadhouse = el.value; render(); }
  if (el.dataset && el.dataset.live === 'admFill') { S.f.admFillSearch = el.value; render(); }
  if (el.dataset && el.dataset.live === 'admIdolSearch') { S.f.admIdolSearch = el.value; render(); }
  if (el.dataset && el.dataset.live === 'admRefSearch') { S.f.admRefSearch = el.value; render(); }
  if (el.dataset && el.dataset.debounce === 'refCode') {
    S.f.refCodeDraft = el.value;
    const code = el.value.trim();
    if (code) debounceSave('refCode', () => guarded(async () => {
      await api('/ac/settings', { method: 'POST', body: { refJoinCode: code } });
      toast('Join code saved');
    }));
  }
  if (el.dataset && el.dataset.debounce === 'legName') {
    const legId = el.dataset.leg;
    const name = el.value.trim();
    if (name) debounceSave('legName:' + legId, () => guarded(async () => {
      await api('/ac/relay-legs', { method: 'POST', body: { legId, name } });
      toast('Leg renamed');
    }));
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.field) S.f[el.dataset.field] = el.value;
  if (el.dataset && el.dataset.change && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
});

/* ════════════════════ polling + init ════════════════════ */
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!S.token || !S.boot || S.busy) return;
  loadBoot(true);
  if (S.route === 'admin' && S.boot.user.isAdmin) loadOverview(true);
}, 60000);

parseRoute();
render();
if (S.token) loadBoot();

})();
