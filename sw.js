/* ═══════════════════════════════════════════
   S.E.E.D. Terminal Service Worker
   - 정적 자산 캐싱 (앱 셸 전략)
   - 네트워크 우선, 실패 시 캐시 폴백
   ═══════════════════════════════════════════ */

const CACHE_VERSION = 'seed-v3-1-1';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

// Install: 코어 자산 사전 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase API 및 외부 요청은 캐싱 안 함 (항상 네트워크)
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('supabase.in') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.protocol === 'ws:' || url.protocol === 'wss:') {
    return; // 브라우저 기본 동작
  }

  // GET 요청만 캐싱
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공 시 캐시에 저장 (백그라운드)
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, responseClone).catch(() => {});
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 폴백
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // 그래도 없으면 오프라인 페이지
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

// Message: 클라이언트에서 캐시 초기화 요청 받기
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => {
      keys.forEach((k) => caches.delete(k));
    });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
