'use strict';

// Service Worker：ホーム画面に追加したアプリを電波がなくても開けるようにする。
// 20261123044324 は web\publish.ps1 が公開のたびに日時へ置き換える（中身が変わると新しい版として入れ直される）
const kCacheVersion = '20261123044324';
const kCacheName = `dot-editor-${kCacheVersion}`;
// 公開するファイルの一覧。web\publish.ps1 が作る
const kFileListUrl = 'sw-files.json';

self.addEventListener('install', (event) => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

// 一覧が読めなくても、開いたファイルは下の fetch で順に保存されるので、失敗しても止めない。
// cache.addAll は Chrome で「Entry already exists」と全体が失敗することがあったので、1つずつ入れる
async function precache()
{
    const cache = await caches.open(kCacheName);
    try {
        const response = await fetch(kFileListUrl, { cache: 'no-store' });
        const files = await response.json();
        const results = await Promise.allSettled(files.map((file) => cache.add(file)));
        const failedCount = results.filter((result) => result.status === 'rejected').length;
        if (failedCount > 0) console.warn(`sw.js: ${failedCount} 個のファイルを先に保存できませんでした`);
    } catch (error) {
        console.warn('sw.js: 先に保存できませんでした', error);
    }
}

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key !== kCacheName) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(networkFirst(request));
});

// 直した版がすぐ届くよう、電波があるときはネットから取り、なければ保存しておいた物を使う
async function networkFirst(request)
{
    const cache = await caches.open(kCacheName);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached !== undefined) return cached;
        throw error;
    }
}
