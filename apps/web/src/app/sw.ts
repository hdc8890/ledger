/// <reference lib="webworker" />
//
// Serwist service worker entry. Compiled to public/sw.js at build time;
// `self.__SW_MANIFEST` is replaced with the generated precache manifest.
// This file runs only in the service-worker context, never in the app
// runtime, so it is excluded from unit-test coverage.
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// The build replaces this single reference with the precache manifest;
// it must appear exactly once in the source.
const manifestEntries = self.__SW_MANIFEST;

const serwist = new Serwist({
  // `exactOptionalPropertyTypes` forbids passing `undefined` explicitly;
  // only include the key when the build injected a manifest.
  ...(manifestEntries ? { precacheEntries: manifestEntries } : {}),
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
});

serwist.addEventListeners();
