/**
 * Kyber: Amber as a keyboard, so the whole app is one globe-tap away inside any
 * chat, without anyone in the thread installing anything.
 *
 * Only built when AMBER_KYBER=1 (see app.config.js). The keychain group is the
 * one the app writes the session into (lib/secureStorage.ts); without it the
 * keyboard cannot be signed in.
 *
 * @type {import('@bacons/apple-targets/app.config').Config}
 */
module.exports = {
  type: 'keyboard',
  name: 'Kyber',
  displayName: 'Kyber',
  // Apple requires an app extension bundle identifier to be prefixed by its
  // containing app's identifier. A relative suffix keeps beta/prod targets
  // aligned automatically (for this TestFlight app: .beta.kyber).
  bundleIdentifier: '.kyber',
  deploymentTarget: '16.0',
  frameworks: ['SwiftUI'],
  entitlements: {
    'keychain-access-groups': ['$(AppIdentifierPrefix)com.joinrytual.amber.shared'],
  },
};
