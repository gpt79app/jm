// 한 번 열면 인터넷 없이도 열리게 앱 파일을 둔다. 자료(CSV)는 여기가 아니라 IndexedDB 에 있다.
// 파일을 바꾸면 VERSION 을 올린다(새 판을 받아 두고, 다음에 열 때 바뀐다)
const VERSION = "jm-15";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "storage.js", "manifest.webmanifest",
  "core/csv.js", "core/hangul.js", "core/loader.js", "core/model.js", "core/ranking.js", "core/search.js",
  "core/subcategories.js", "core/tags.js", "core/unzip.js", "core/views.js", "core/xlsx.js",
  "ui/export.js", "ui/panels.js", "ui/table.js", "ui/util.js",
  "icons/icon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 네트워크 먼저(새 판), 안 되면 받아 둔 것
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? caches.match("index.html"))),
  );
});
