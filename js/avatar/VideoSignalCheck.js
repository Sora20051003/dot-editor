'use strict';

// 測る間隔。毎コマ測るほど急ぐものではないので、軽くするため間をあける
const kSignalCheckIntervalMs = 1000;
// 映像を縮めて測る大きさ（一色かどうかを見るだけなので小さくてよい）
const kSignalSampleWidth = 64;
const kSignalSampleHeight = 48;
// 明るさのばらつき（標準偏差・0〜255）がこれ以下なら一色とみなす。
// HDMI がつながっていないキャプチャ機器は 0 だった。暗い部屋の顔でもこれより大きい
const kFlatContrast = 3;
// 一色がこの時間続いたら「映像が出ていない」とする（カメラの起動直後の一瞬の黒で知らせないため）
const kNoSignalMs = 2000;

// カメラの映像が出ているか（真っ黒・一色のままでないか）を見る。
// 映像が出ていないと顔も見つからないので、「顔が見つかりません」と区別して知らせるために使う
class VideoSignalCheck
{
    constructor()
    {
        const canvas = document.createElement('canvas');
        canvas.width = kSignalSampleWidth;
        canvas.height = kSignalSampleHeight;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        this.reset();
    }

    // カメラを始めたとき・切り替えたときに、前のカメラの結果を消す
    reset()
    {
        this.lastCheckAt = -Infinity;
        this.flatSince = null;
        this.isNoSignal = false;
    }

    update(video, now)
    {
        if (now - this.lastCheckAt < kSignalCheckIntervalMs) return;
        this.lastCheckAt = now;
        // 1コマも届かないのも、映像が出ていないのと同じ
        const isFlat = video.readyState < 2 || video.videoWidth === 0 || this.isFlatFrame(video);
        if (!isFlat) {
            this.flatSince = null;
            this.isNoSignal = false;
            return;
        }
        this.flatSince ??= now;
        this.isNoSignal = now - this.flatSince >= kNoSignalMs;
    }

    isFlatFrame(video)
    {
        const ctx = this.ctx;
        ctx.drawImage(video, 0, 0, kSignalSampleWidth, kSignalSampleHeight);
        const pixels = ctx.getImageData(0, 0, kSignalSampleWidth, kSignalSampleHeight).data;
        let sum = 0;
        let sumOfSquares = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
            sum += brightness;
            sumOfSquares += brightness * brightness;
        }
        const count = pixels.length / 4;
        const mean = sum / count;
        const contrast = Math.sqrt(Math.max(0, sumOfSquares / count - mean * mean));
        return contrast <= kFlatContrast;
    }
}
