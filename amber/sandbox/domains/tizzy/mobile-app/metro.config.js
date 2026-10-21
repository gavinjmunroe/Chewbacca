// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Enable Hermes for better performance
config.transformer = {
  ...config.transformer,
  // Enable minification in production
  minifierConfig: {
    compress: {
      drop_console: true, // Remove console.logs in production
    },
  },
  // Enable inline requires for lazy loading
  inlineRequires: true,
  // Use faster minifier
  minifierPath: 'metro-minify-terser',
};

// Optimize asset resolution
config.resolver = {
  ...config.resolver,
  // Support for additional asset types
  assetExts: [
    ...config.resolver.assetExts,
    'db',
    'sqlite',
    'wav', // For notification sounds
  ],
};

module.exports = config;
