'use strict';

// まばたきの間隔（人はだいたい 2〜6 秒に1回）と、目を閉じている時間
const kBlinkMinGapMs = 2000;
const kBlinkMaxGapMs = 6000;
const kBlinkClosedMs = 120;
// ときどき2回続けてまばたきすると、機械っぽさが減る
const kDoubleBlinkChance = 0.2;
const kDoubleBlinkGapMs = 160;

// 数秒おきに目を閉じる
class Blinker
{
    constructor(random = Math.random)
    {
        this.random = random;
        this.nextBlinkAt = null;
        this.closedUntil = 0;
    }

    isClosed(now)
    {
        if (this.nextBlinkAt === null) this.nextBlinkAt = now + this.randomGap();
        if (now >= this.nextBlinkAt) {
            this.closedUntil = now + kBlinkClosedMs;
            const isDouble = this.random() < kDoubleBlinkChance;
            this.nextBlinkAt = this.closedUntil + (isDouble ? kDoubleBlinkGapMs : this.randomGap());
        }
        return now < this.closedUntil;
    }

    randomGap()
    {
        return kBlinkMinGapMs + this.random() * (kBlinkMaxGapMs - kBlinkMinGapMs);
    }
}
