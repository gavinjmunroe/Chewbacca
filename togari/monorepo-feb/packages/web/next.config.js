/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@togari/core'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
