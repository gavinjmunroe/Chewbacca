# MOVED

This directory used to hold the Togari Connect Chrome extension. As of
2026-05-27, the canonical source lives at:

**https://github.com/amber-organization/amber-chrome**

The repo was moved out of togari-bma-dvlp because the extension is no
longer Togari-specific. It's the shared per-user connection-synthesis
surface for every amber-organization agent (Medha, Togari, future).

## What this means for you

- All future patches go to `amber-organization/amber-chrome`.
- The published Chrome Web Store extension `Togari Connect v1.0.0`
  is unchanged: same extension ID, same allowlist, same behavior.
- Wave 2 will re-publish as `Amber Connect v2.0.0` with a new
  extension ID and a multi-product allowlist that includes Medha.

See the Wave 2 spec for the refactor plan.
