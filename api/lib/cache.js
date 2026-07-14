// Tiny per-instance TTL cache. Shared across warm invocations of the same
// Azure Functions host (module-level Map survives between requests on a warm
// instance). NOT distributed — each cold instance has its own copy, which is
// exactly what we want: a short TTL on read-heavy SHARED data (the same for
// every player) so a game-day crowd hitting /api/bootstrap doesn't re-run the
// same dozen queries against the small shared Fabric F2 capacity hundreds of
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

function bust(key) { store.delete(key); }

module.exports = { get, set, bust };
