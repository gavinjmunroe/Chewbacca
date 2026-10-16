# Intro ledger

A dated, append-only record of every contact we hand a creator-partnership client, so a deal
that closes months after the intro can be traced back to the day we delivered it. Sabo asked
for this on the 10/16 call: "It could happen 3 months down the line. Like, how do you protect
yourself?"

## How it proves a date

- The server stamps `received_at` and `delivered_on` from its own clock. A caller that sends
  `delivered_on` is refused, so nothing can be backdated.
- Each record carries `seq`, `prev` and `hash` (SHA-256 of the previous hash plus the record).
  Editing, reordering or dropping any record breaks `/verify`, and the server refuses to start
  on a broken file.
- There is no update or delete. A mistake gets a `kind: "correction"` record naming the `seq`
  it supersedes.
- The Clay row gets `Ledger Record` = `#seq` plus the first 16 hex of the hash. Clay keeps its
  own edit history, so a third party also holds a timestamped copy of every hash.

## Run it

| What                            | Where                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Service                         | https://intro-ledger.up.railway.app (Railway project `intro-ledger`, volume at `/data`)          |
| Health, public, no contact data | `GET /health`, `GET /verify`                                                                     |
| One client's intros             | `GET /intros?client=sabo` or `/intros.csv?client=sabo`, Bearer admin or that client's read token |
| Record one                      | `POST /intros`, Bearer `LEDGER_TOKEN`                                                            |

`LEDGER_TOKEN` lives in Railway and in `~/.config/intro-ledger/env` (mode 600) with
`LEDGER_URL`. `LEDGER_READ_TOKENS="sabo:<token>"` gives a client a key that reads only its own
rows.

## A new client

1. Write `~/.chewbacca/gtm/clients/<slug>.json` with `client_slug`, `ws`, `table`, `view`,
   `creator`, `ready_value` and the column names (copy `sabo.json`).
2. `python3 tools/creator_gtm/deliver.py ~/.chewbacca/gtm/clients/<slug>.json` is a dry run that lists the rows it would record, and `--live` records every Ready row and stamps Delivered On, Delivered For
   and Ledger Record. It adds those three columns the first time.
3. Rerunning is safe: stamped rows are skipped and the ledger returns the original record for
   the same client, email and creator.

Run `deliver.py --live` right after a batch is marked Ready, from wherever the batch ran. It's
a one-shot command, so nothing recurring runs on anyone's Mac.

## Stop it

From this folder, `railway link --project intro-ledger --service intro-ledger` then `railway down` removes the deployment and keeps the volume.
Deleting the Railway project deletes the ledger for good, so export
`/intros.csv` first.

Built with Chewbacca
