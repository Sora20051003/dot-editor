'use strict';

// 1回だけ鳴るタイマー。新しく start すると前の予約は取り消す（場面が変わったら古い予約を鳴らさないため）
class OneShotTimer
{
    constructor()
    {
        this.handle = 0;
        this.startedAt = 0;
        this.durationMs = 0;
    }

    start(durationMs, callback)
    {
        this.cancel();
        this.startedAt = performance.now();
        this.durationMs = durationMs;
        this.handle = setTimeout(() => {
            this.handle = 0;
            callback();
        }, durationMs);
    }

    cancel()
    {
        if (this.handle !== 0) clearTimeout(this.handle);
        this.handle = 0;
    }

    get remainingMs()
    {
        if (this.handle === 0) return 0;
        return Math.max(0, this.durationMs - (performance.now() - this.startedAt));
    }
}
