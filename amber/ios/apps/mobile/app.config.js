/**
 * app.json is the config. This file only exists to add Kyber, the Amber
 * keyboard, to builds that ask for it.
 *
 * WHY OPT-IN. Extension targets were taken out of the TestFlight build on
 * 2026-08-17 (e4a4c7a, "single target for TestFlight"), and that decision is not
 * this file's to reverse. Without AMBER_KYBER=1 this returns app.json untouched,
 * so the default build is the same build it was. With it, the build gains:
 *
 *   - the kyber target only (`match`), not every folder under targets/, so the
 *     record widget stays out exactly as it was left;
 *   - a keychain access group the app and the keyboard share, which is how the
 *     keyboard signs in as the app's user (see lib/secureStorage.ts). The app's
 *     own group is listed first so it stays the default for every other item.
 *
 * `eas build --profile kyber` sets the variable (eas.json).
 */
module.exports = ({ config }) => {
  if (process.env.AMBER_KYBER !== '1') return config;
  const ios = config.ios ?? {};
  return {
    ...config,
    ios: {
      ...ios,
      // scripts/kyber-testflight.sh reads the real highest build on App Store
      // Connect and passes the next one here, so a Kyber upload never collides
      // with a build somebody already shipped. app.json is left alone.
      ...(process.env.AMBER_BUILD_NUMBER ? { buildNumber: process.env.AMBER_BUILD_NUMBER } : {}),
      entitlements: {
        ...(ios.entitlements ?? {}),
        'keychain-access-groups': [
          '$(AppIdentifierPrefix)com.joinrytual.amber',
          '$(AppIdentifierPrefix)com.joinrytual.amber.shared',
        ],
      },
    },
    plugins: [['@bacons/apple-targets', { match: 'kyber' }], ...(config.plugins ?? [])],
  };
};
