# vendor/ — intentionally empty post-2026-05-04

The previous `togari-peoplerank` git submodule was removed when the
standalone `amber-organization/togari-peoplerank` repository was consolidated
into `amber-organization/togari-platform`. The submodule URL had become a
404, breaking `git submodule update --init --recursive` for every clone.

`Tiwari/tiwari-peoplerank/src/togari-adapter.js` does not import the vendored
source — it speaks to the deployed service over HTTPS at
`https://togari-amber-production.up.railway.app`. Removing the submodule has
**zero runtime effect**.

## To restore an audit-trail submodule

When the `togari-platform` repo exposes a stable subpath (or a per-primitive
mirror is published), re-add it here:

```
git submodule add https://github.com/amber-organization/togari-platform.git \
  Tiwari/tiwari-peoplerank/vendor/togari
```

Until then, version-pinning of the deployed service happens through
`togari-platform` release tags consumed by the Railway deploy of
`togari-amber-production.up.railway.app`.
