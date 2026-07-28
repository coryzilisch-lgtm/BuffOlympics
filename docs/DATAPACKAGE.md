# Publishing the event program as an OKF Data Package

The **public, static half** of the event — the game catalog, time slots, bracket
structure, the day's schedule, and relay legs — is published as an
[Open Knowledge Foundation "Data Package"](https://dataprotocols.org/data-package/)
(Frictionless Data): a `datapackage.json` descriptor plus one CSV per resource.
Two ways to get it:

| | Always current? | Needs an admin account? | Where |
|---|---|---|---|
| **Live endpoint** | Yes — reads straight from the DB | No (anonymous) | `GET /api/datapackage` |
| **One-off script** | Only as of when you run it | Yes | `scripts/build-datapackage.js` |

## What's in it — and what's deliberately left out

| Included | Excluded |
|---|---|
| Game catalog (rules, venue, scoring type, points) | Sign-ups / rosters (who's doing what) |
| Time slots + capacities | Live headcounts per slot |
| Bracket structure / rounds | Dip Off entries |
| The day's shared schedule | Results / scores (**sealed** until admin reveal) |
| Relay legs (name, cap, description) | Relay/dip participant rosters |
| | People, ref assignments, ref join code |

The excluded data is either sealed-until-reveal or personal (participant names) —
neither belongs in an openly published dataset. If you need a package that
includes results, do it after the admin reveals scores at Closing Ceremony —
don't publish sealed data before the reveal.

## Live endpoint (`GET /api/datapackage`)

Anonymous, no query params. Returns the `datapackage.json` descriptor, with each
resource's `path` pointing at:

```
GET /api/datapackage-file?name=<games|game-slots|bracket-rounds|schedule|relay-legs>
```

which streams that resource's CSV. Anyone can fetch the descriptor and follow the
resource links — this is meant to be shared as a live link.

**Fabric load:** both routes read the SAME `~120s`-cached ROSTER block that
`bootstrap`/`ac-overview` already share across every viewer
(`loadRosterBlock` in `api/lib/bootstrap.js`) — they run **no query of their
own on a warm cache**, and on a cold cache they trigger the same query batch
any normal page load would anyway. Neither endpoint polls anything on its own;
they only touch Fabric when someone actually requests them.

## One-off script (`scripts/build-datapackage.js`)

For a point-in-time snapshot you want to save or hand someone directly, rather
than a live link:

```bash
BASE_URL="https://<your-swa>.azurestaticapps.net" \
ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
node scripts/build-datapackage.js
```

Requires an **admin** account — it reads `GET /api/ac-overview` for the full game
catalog (win points, round points, team size, bracket rounds).

Optional env: `OUT_DIR` (default `./dist/datapackage`, gitignored).

Output:

```
dist/datapackage/
  datapackage.json
  games.csv
  game-slots.csv
  bracket-rounds.csv
  schedule.csv
  relay-legs.csv
```

## Package format

`datapackage.json` follows the `tabular-data-package` profile: each resource
carries a `schema.fields` array (name/type/description) describing its CSV, so
the package is loadable by any Frictionless Data / OKF tooling (e.g. Python's
`frictionless` or `datapackage` libraries) without extra guesswork. The
resource/field definitions live in one place, `api/lib/datapackage.js`, shared
by both live endpoints (`api/datapackage/`, `api/datapackage-file/`).

The license (`CC-BY-4.0`) is a placeholder — change it in
`api/datapackage/index.js` (and `scripts/build-datapackage.js`) if the event
program should be published under different terms.
