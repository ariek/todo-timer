// サービスワーカー: アプリ本体をキャッシュしてオフラインでも開けるようにする
// アプリのファイルを変更したら CACHE_VERSION を上げる（更新通知のきっかけになる）

const CACHE_VERSION = 'v0.32.0';
const CACHE_NAME = `todo-timer-${CACHE_VERSION}`;
const FONT_CACHE = 'todo-timer-fonts';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './game.js',
  './icons.js',
  './overview.js',
  './quests.js',
  './timer.js',
  './sortable.js',
  './settings.js',
  './bulk.js',
  './bulkedit.js',
  './log.js',
  './effects.js',
  './dialog.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// ローカルの確認用サーバー（localhost や家庭内 LAN のアドレス）かどうか。
// そこではキャッシュ優先だと「直したのに1つ前の見た目が出る」（1回目の再読み込みは古いファイル）ので、常に最新を取りに行く
const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // ブラウザの HTTP キャッシュに残った古いファイルを拾わないよう、必ずサーバーから取り直す
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME && key !== FONT_CACHE).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

// ページ側から「すぐ切り替えて」と言われたら待機をやめる
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // フォント: キャッシュがあればそれを返し、裏で更新する
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // ローカルの確認用サーバー: ネットワーク優先（つながらないときだけキャッシュ。オフラインの確認はできる）
  if (url.origin === self.location.origin && IS_LOCAL) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-cache' })).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request, { ignoreSearch: true })),
    );
    return;
  }

  // 同一オリジン: キャッシュ優先、なければネットワーク
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => {
        const fetched = fetch(new Request(request, { cache: 'no-cache' })).then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        }).catch(() => cached);
        return cached || fetched;
      }),
    );
  }
});

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const fetched = fetch(request).then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached);
      return cached || fetched;
    }),
  );
}
