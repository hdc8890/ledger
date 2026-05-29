import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Precache the offline fallback so navigations work without a network.
  additionalPrecacheEntries: [{ url: '/~offline', revision: null }],
  // The dev server runs on Turbopack; the worker is a production concern.
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSerwist(nextConfig);
