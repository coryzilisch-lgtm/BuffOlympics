// Tiny per-instance TTL cache. Shared across warm invocations of the same
// Azure Functions host (module-level Map survives between requests on a warm
// instance). NOT distributed — each cold instance has its own copy, which is
// exactly what we want: a short TTL on read-heavy SHARED data (the same for
// every player) so a game-day crowd hitting /api/bootstrap doesn't re-run the
// same dozen queries against the small shared Fabric capacity hundreds of
// times a minute. Writes bust the key so the next read refills.
const store = new Map();

function get(key) {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { store.delete(key); return null; }
  return e.val;
}

function set(key, val, ttlMs) {
  store.set(key, { val, exp: Date.now() + ttlMs });
}

function bust(key) { store.delete(key); inflight.delete(key); }

// ── single-flight ──────────────────────────────────────────────────────────
// A bust (or a TTL expiry) during a game-day crowd means every request that
// arrives before the refill lands is a cache MISS, and without this they'd all
// run the same query set at once — a stampede that hits Fabric with N× the
// work at the worst possible moment. Concurrent misses now share ONE in-flight
// refill: the first caller queries, everyone else awaits the same promise.
const inflight = new Map();

async function getOrFill(key, fill, ttlFor) {
  const hit = get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const val = await fill();
    set(key, val, typeof ttlFor === 'function' ? ttlFor(val) : ttlFor);
    return val;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

// Force a refill even on a cache hit (writers that must not read their own
// stale copy), still sharing one in-flight refill with concurrent callers.
async function refill(key, fill, ttlFor) {
  bust(key);
  return getOrFill(key, fill, ttlFor);
}

// ── user rows ──────────────────────────────────────────────────────────────
// EVERY authenticated request loads its bo_users row (token verify → row), so
// on game day that single query is one DB round-trip per poll per person —
// the largest per-head cost left once the shared blocks are cached. The row
// changes rarely (tribe pick, ref/admin toggle, password reset), so a short
// TTL is safe, and the writes that DO change it call bustUsers().
const USER_TTL_MS = 45000;
const users = new Map();

function getUser(id) {
  const e = users.get(id);
  if (!e) return null;
  if (Date.now() > e.exp) { users.delete(id); return null; }
  return e.val;
}

function setUser(id, row) {
  users.set(id, { val: row, exp: Date.now() + USER_TTL_MS });
}

// Drop every cached row. Called by any write that can change identity/roles —
// a password reset must kill old sessions NOW (token_version), not in 45s.
function bustUsers() { users.clear(); }

module.exports = { get, set, bust, getOrFill, refill, getUser, setUser, bustUsers, USER_TTL_MS };
