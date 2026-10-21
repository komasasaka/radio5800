// オフライン用のごく小さなサービスワーカー（4:6メソッドと同じ方式）。
// 初回アクセス時に本体と画像を保存し、以降はネットワークを試してから保存分にフォールバックする。
// サーバに届かない時は失敗せず応答待ちになることがあるので、一定時間で見切る。
const CACHE = 'radio-pwa-v278';
const ASSETS = ['./', 'index.html', 'manifest.json?v=56', 'icon-192.png?v=56', 'icon-512.png?v=56', 'apple-touch-icon.png', 'plate-font.woff2?v3'];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // 同じサーバの 4:6メソッド・タイマーのキャッシュには触らない
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('radio-pwa-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromCache(req) {
  // ?付きで開かれても当たるように検索部分は無視。ページ遷移なら最後は本体を返す
  return caches.match(req, { ignoreSearch: true, cacheName: CACHE })
    .then(res => res || (req.mode === 'navigate' ? caches.match('index.html', { cacheName: CACHE }) : undefined))
    .then(res => res || Response.error());
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 局の検索・配信・家のラジオは他のサーバ。ここで受けると配信をキャッシュしようとするので触らない
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // 中継している配信（stream.php）は終わりのない音声なので、受けない・保存しない
  if (new URL(e.request.url).pathname.endsWith('/stream.php')) return;
  const network = fetch(e.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  });
  const timeout = new Promise((_, reject) => setTimeout(reject, NETWORK_TIMEOUT_MS));
  e.respondWith(
    Promise.race([network, timeout]).catch(() => fromCache(e.request).then(res =>
      // 保存分が無ければ、遅れてでもネットワークの結果を待つ
      res.type === 'error' ? network.catch(() => res) : res
    ))
  );
});
