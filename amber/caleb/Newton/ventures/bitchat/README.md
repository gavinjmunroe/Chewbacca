# bitchat as Amber safety substrate

Vendored from [permissionlesstech/bitchat](https://github.com/permissionlesstech/bitchat)
at `c60eff2c` (Unlicense / public domain).

## Why this lives in Amber

Amber is a health network. Health is not only therapy and labs. Health
is also being reachable when you are far from a tower, far from the
people who love you, in a place where the phone gives up. Burning Man
is the obvious case. Backcountry is another. Power outages. Protests.
Any environment where the carrier is either absent or politically
suspect.

`bitchat` is a Bluetooth LE mesh chat app. No server, no accounts, no
phone number, no internet. Peers route messages for each other across
a dynamic graph. That is the same topology Amber already thinks in,
just at radio range instead of relationship range.

We are not trying to fork it. We are using it as a substrate.

## Integration path

This vendor is **not wired into `Newton/agent/agent.js` yet**. It is a
Swift package, not a Node module. The integration order is:

1. **amber-ios** (next) - embed `bitchat` as a Swift Package
   dependency, expose a `MeshChannel` that mirrors the existing
   `LoopChannel` abstraction. The app chooses transport by signal,
   not by config.
2. **amber-id** - teach the identity layer that a Solana cNFT can be
   reached by either phone or mesh nonce. A user IS their identity,
   not their carrier.
3. **amber-agent** - once iOS is speaking mesh, add a `transport=mesh`
   branch to `Newton/agent/lib/transport.js` that proxies to a future
   relay the iOS app runs when it has both BLE and IP.

Until step 1 ships, this folder is a reading room, not a runtime
dependency. Do not import from it in Node code. Do not add it to
`package.json`. The scheduled check-in path will continue to use
Loop Message via `Newton/agent/scripts/send-checkin.js`.

## What lives here

- `vendor/` - submodule, pinned SHA above. Do not edit in place.
  Bumps go through a normal submodule update PR.
- `README.md` (this file) - why it is here, who it serves, what it
  guards against.

## What this does not do

- Does not replace Loop Message. Loop stays the primary transport
  for urban, carrier-reachable check-ins.
- Does not replace Twilio. SMS is the cross-carrier fallback.
- Does not change the six dimensions of health. Mesh is a transport,
  not a lens.
- Does not leak the agent's voice doctrine. The voice is the same
  on mesh as on iMessage. Amber sounds like Amber regardless of
  radio. See [`docs/AMBER-VOICE.md`](../../../docs/AMBER-VOICE.md).

## Safety stance

We do not promise encrypted delivery at this layer until the iOS team
audits the handshake. We do not promise Amber is safe to use on mesh
during a true emergency. Call 911 if someone is in danger. This
substrate exists so that on a Tuesday at Burning Man, a friend who is
disoriented can still reach the person who loves them.

That is what Amber is for.
