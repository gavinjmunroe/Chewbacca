# vendor/ — intentionally empty post-2026-05-04

The previous `togari-opportunity` git submodule was removed when that
repository was consolidated into `amber-organization/togari-platform`. The
submodule URL had become a 404, breaking `git submodule update --init
--recursive` for every clone.

`Tiwari/tiwari-opportunity/src/togari-adapter.js` does not import the
vendored source — it speaks to the deployed service over HTTPS at
`https://togari-clay-production.up.railway.app`. Removing the submodule has
**zero runtime effect**.

See `Tiwari/tiwari-peoplerank/vendor/README.md` for the restore procedure.
