# Publishing the event program as an OKF Data Package

`scripts/build-datapackage.js` exports the **public, static half** of the event —
games, time slots, bracket structure, the day's schedule, and relay legs — as an
[Open Knowledge Foundation "Data Package"](https://dataprotocols.org/data-package/)
(Frictionless Data): a `datapackage.json` descriptor plus one CSV per resource.

It's a one-off script you run by hand whenever you want a fresh export (e.g. to
publish the day's program, or archive it after the event).

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
includes results, run it after the admin reveals scores at Closing Ceremony and
extend `RESOURCES` in the script — don't publish sealed data before the reveal.

## Running it

```bash
BASE_URL="https://<your-swa>.azurestaticapps.net" \
ADMIN_EMAIL="you@company.com" ADMIN_PASSWORD="your-password" \
node scripts/build-datapackage.js
```

Requires an **admin** account — it reads `GET /api/ac-overview` for the full game
catalog (win points, round points, team size, bracket rounds), which isn't all
present in the plain per-user `/api/bootstrap` payload.

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

`datapackage.json` follows the `tabular-data-package` profile: each resource
carries a `schema.fields` array (name/type/description) describing its CSV, so
the package is loadable by any Frictionless Data / OKF tooling (e.g. Python's
`frictionless` or `datapackage` libraries) without extra guesswork.

The license (`CC-BY-4.0`) is a placeholder — change it in the script if the
event program should be published under different terms.
