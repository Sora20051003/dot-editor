'use strict';

const kMsPerSecond = 1000;

// 決まった速さ（コマ／秒）でコマを送る。画面の更新回数ではなく経過時間で数えるので、
// 重い絵で画面の更新が遅れても、再生の速さは変わらない（遅れた分はコマを飛ばす）
class AnimationPlayer
{
    // onStep(stepCount)：stepCount コマ進めてほしいときに呼ぶ
    constructor(onStep)
    {
        this.onStep = onStep;
        this.isPlaying = false;
        this.fps = 1;
        this.elapsedMs = 0;
        this.lastTime = 0;
        this.frameRequest = 0;
    }

    play(fps)
    {
        this.fps = fps;
        if (this.isPlaying) return;
        this.isPlaying = true;
        this.elapsedMs = 0;
        this.lastTime = performance.now();
        this.frameRequest = requestAnimationFrame((now) => this.tick(now));
    }

    stop()
    {
        this.isPlaying = false;
        cancelAnimationFrame(this.frameRequest);
    }

    tick(now)
    {
        if (!this.isPlaying) return;
        this.elapsedMs += now - this.lastTime;
        this.lastTime = now;
        const intervalMs = kMsPerSecond / this.fps;
        const steps = Math.floor(this.elapsedMs / intervalMs);
        if (steps > 0) {
            this.elapsedMs -= steps * intervalMs;
            this.onStep(steps);
        }
        this.frameRequest = requestAnimationFrame((time) => this.tick(time));
    }
}
