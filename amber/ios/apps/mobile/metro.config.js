const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Privy's SDK depends on `jose`, which exposes a Node-only ESM build at
// `dist/node/esm/...`. Metro by default resolves to that build and then
// chokes on the `crypto` import. Telling Metro to prefer the `browser` /
// `react-native` package conditions lands jose's RN-friendly entry instead.
config.resolver.unstable_conditionNames = ['browser', 'react-native', 'import', 'require'];
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: './global.css' });
