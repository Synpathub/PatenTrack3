import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@patentrack/db',
    '@patentrack/shared',
    '@patentrack/ui',
    '@patentrack/business-rules',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  serverExternalPackages: ['@node-rs/argon2'],
};

export default nextConfig;
