'use strict';

// ホーム画面に追加したアプリを電波がなくても開けるよう、sw.js（Service Worker）を登録する。
// https で公開しているときだけ動かす（file:// や exe 版の https://dotapp.local では使わない）
(() => {
    const kExeHostName = 'dotapp.local';
    const isPublished = location.protocol === 'https:' && location.hostname !== kExeHostName;
    if (!isPublished || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((error) => {
            // 登録できなくても普通に使えるので、記録だけ残す
            console.warn('ServiceWorkerSetup: 登録できませんでした', error);
        });
    });
})();
