const CACHE_NAME = 'eattailor-v27';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/settings.js',
  '/onboarding.js',
  '/strava-integration.js',
  '/firestore-helpers.js'
];

// Install service worker and pre-cache static assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('✅ Cache opened');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ All files cached');
        return self.skipWaiting();
      })
  );
});

// Network-first strategy: try network, fall back to cache for offline support
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests and API calls
  if (!event.request.url.startsWith(self.location.origin) ||
      event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response before caching (response can only be consumed once)
        const responseToCache = response.clone();

        // Update cache with fresh response
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              console.log('📦 Serving from cache (offline):', event.request.url);
              return cachedResponse;
            }
            // No cache available
            console.error('❌ No cache available for:', event.request.url);
            throw new Error('No cache available');
          });
      })
  );
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
  console.log('🔧 Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
    .then(() => {
      console.log('✅ Service Worker activated');
      return self.clients.claim();
    })
  );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
