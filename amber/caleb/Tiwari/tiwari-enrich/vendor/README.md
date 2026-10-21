# vendor/ — intentionally empty post-2026-05-04

The previous `togari-healthcare` git submodule was removed when that
repository was consolidated into `amber-organization/togari-platform`. The
submodule URL had become a 404, breaking `git submodule update --init
--recursive` for every clone.

`Tiwari/tiwari-enrich/src/togari-adapter.js` (when present) speaks to
deployed Togari surfaces over HTTPS — no source-level import was ever taken.
Removing the submodule has **zero runtime effect**.

See `Tiwari/tiwari-peoplerank/vendor/README.md` for the restore procedure.
