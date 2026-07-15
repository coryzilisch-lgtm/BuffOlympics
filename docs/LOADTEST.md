# Load & stress testing Buff Olympics

Two scripts, two different questions. Run both **before real sign-ups open**, with
**Event mode = "Sign-Up"**, against the **live deployment** (there's one Fabric
database behind it, so that's the only way to test the real capacity). Both
scripts create only `zz…`-marked test data and **delete every trace of it when
they finish** — no residue in the event data, no real rosters or scores touched.

| Script | Question it answers |
|---|---|
| `scripts/concurrency-loadtest.js` | *Correctness under contention* — when N people fight for the **same** capped slot, does exactly the cap get in and everyone else get a clean "slot just filled up"? (Proves the atomic `UPDLOCK/HOLDLOCK` guard — no oversell.) |
| `scripts/loadtest-crowd.js` | *Capacity under a crowd* — can Fabric handle everyone opening the app at once (read stampede) and a sign-up rush (write burst) without throttling or slowing to a crawl? |

## What actually stresses the system

Every phone calls `GET /api/bootstrap` on open and **re-polls every 60s**. That
endpoint is split (`api/lib/bootstrap.js`): ~15 "shared" queries are **cached
in-process ~20s** so a crowd doesn't re-run them, and only **2 per-user queries**
run live each call. So steady-state reads are cheap. The spikes that matter:

1. **Read stampede** — event start or the Closing-Ceremony score reveal: every
   phone reloads at once.
2. **Sign-up burst** — "sign-ups are open!" and a slice of the crowd taps Join in
   the same few seconds. Each signup runs the atomic transaction **and** rebuilds
   a fresh bootstrap, so writes are the heaviest single operation.

One F-specific caveat: the ~20s cache is **per Function instance**, so if Static
Web Apps scales out to several instances under load, you get several times the
shared refills. Watch for it in the metrics.

## Capacity: we're on Fabric **F4**

F4 is **double** F2 (the value the older notes assumed) — comfortable headroom
for the expected **100–250** peak. The crowd test's default `USERS=200` sits at
the top of that range on purpose; bump it higher to find the ceiling.

## Running the crowd test

```bash
BASE_URL="https://<your-swa>.azurestaticapps.net" \
ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
node scripts/loadtest-crowd.js
```

Tunable via env vars (defaults in parentheses):

| Var | Meaning |
|---|---|
| `USERS` (200) | Simulated phones. Try 250, then 400, to find where it strains. |
| `SLOTS` (25) | Test slots the sign-up burst spreads across (parallel writes, not lock contention). |
| `STAMPEDE_ROUNDS` (3) | Read-stampede repeats — round 1 is a cold cache, later rounds warm. |
| `DURATION_S` (90) | Length of the sustained mixed-load phase. |
| `POLL_S` (60) | Per-user poll cadence — the real one. |
| `CHURN_MS` (400) | Gap between background sign-up toggles in the sustained phase. |
| `TIMEOUT_MS` (15000) | Per-request timeout; a hung request counts as a failure, not a hang. |
| `READ_ONLY` (off) | `1` runs only the read phases — works in any Event mode, writes nothing. |

The three phases: **A** fires `USERS` simultaneous bootstrap reads (× rounds);
**B** fires `USERS` simultaneous sign-ups spread across the test slots; **C**
holds a sustained poll + write-churn mix for `DURATION_S`. Each phase prints a
latency + error breakdown, then a final verdict.

## What to watch while it runs

Open the **Microsoft Fabric Capacity Metrics** app in the portal (Fabric →
your capacity → Metrics) during the run. The script tells you what *users*
experienced; the metrics app tells you whether the *capacity* was the
bottleneck. Watch:

- **CU (capacity unit) utilization %** — if it pins near 100% and the "Throttling"
  / "Overloaded minutes" panels light up, F4 is the limit.
- **SQL database — CPU / query duration** — sustained high CPU or climbing query
  duration means the queries, not the app, are the constraint.
- In the Azure portal, the **Static Web App → Functions** metrics: instance count
  (cache dilution) and any 5xx.

## Reading the result

The script prints, per phase: request count, 2xx, 4xx (incl. `409` "full" — a
*correct* rejection, not an error), **429 throttled**, **5xx**, **timeouts/network**,
and latency **p50 / p95 / p99 / max**. Then a verdict:

- **✅ HEALTHY** — no 429/5xx/timeouts and p95 < 3s. F4 handled the crowd.
- **⚠️ STRAINED** — any throttling, or p95 ≥ 3s / p99 ≥ 8s. See below.

Thresholds are set for the 100–250 range; edit them near the bottom of
`loadtest-crowd.js` if your bar is different.

## If it strains — the tuning levers (cheapest first)

1. **Lengthen the shared-cache TTL.** `SHARED_TTL_MS` in `api/lib/bootstrap.js`
   (currently `20000`). Bump to 30–45s: fewer shared refills, players still see
   their *own* writes immediately (writers bypass the cache), and headcounts stay
   near-live because every successful signup refreshes the shared copy.
2. **Slow the client poll.** The 60s re-poll drives the steady-state floor. 90s
   halves it with barely-noticeable staleness. (Search the poll interval in
   `app.js`.)
3. **Trim the per-user queries.** `myVote` + `myResults` run on *every* bootstrap.
   `myResults` matters only after scores exist — it could be skipped in Sign-Up
   mode, or folded into the shared block on game day.
4. **Pre-warm before the rush.** Cold starts hurt the first stampede. Hit
   `/api/health` a few times right before you announce sign-ups so an instance is
   already warm.
5. **Only if all else strains: bump the capacity.** F4 → F8 for the event window,
   scale back after. This is the last lever, not the first.

## Concurrency (correctness) test

Separately, confirm the atomic guard still holds — exactly the cap gets a
one-seat slot, no oversell:

```bash
BASE_URL="…" ADMIN_EMAIL="…" ADMIN_PASSWORD="…" \
N=30 CAP=1 node scripts/concurrency-loadtest.js
```

`CAP=1` is the meanest case (a walk-up slot with one seat). Expect `1` in,
`N-1` cleanly turned away, DB agrees → **PASS**.
