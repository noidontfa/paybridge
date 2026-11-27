import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages shipped as TypeScript source.
  transpilePackages: ['@paybridge/checkout-snippet'],
};

export default nextConfig;
