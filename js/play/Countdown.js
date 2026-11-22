'use strict';

const kCountdownTickMs = 250;
const kCountdownWarnSeconds = 10;

// 残り時間の表示。0 になったら onZero を1回だけ呼ぶ
class Countdown
{
    constructor(label)
    {
        this.label = label;
        this.handle = 0;
        this.endsAt = 0;
        this.onZero = null;
    }

    start(durationMs, onZero)
    {
        this.stop();
        this.endsAt = performance.now() + durationMs;
        this.onZero = onZero;
        this.handle = setInterval(() => this.tick(), kCountdownTickMs);
        this.tick();
    }

    stop()
    {
        if (this.handle !== 0) clearInterval(this.handle);
        this.handle = 0;
        this.label.textContent = '';
        this.label.classList.remove('is-warn');
    }

    tick()
    {
        const remainingMs = Math.max(0, this.endsAt - performance.now());
        const seconds = Math.ceil(remainingMs / kMsPerSecond);
        this.label.textContent = `残り ${seconds} 秒`;
        this.label.classList.toggle('is-warn', seconds <= kCountdownWarnSeconds);
        if (remainingMs > 0) return;
        const onZero = this.onZero;
        this.stop();
        this.label.textContent = '時間切れ';
        if (onZero !== null) onZero();
    }
}
