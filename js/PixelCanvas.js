'use strict';

// 絵そのもの（幅×高さのマス目の色）を持つ。画面表示は ViewRenderer の担当。
// 画面へは変わった範囲だけ送りたいので、書き換えた範囲（dirty）を覚えておく。
class PixelCanvas
{
    constructor(width, height)
    {
        this.reset(width, height);
    }

    reset(width, height)
    {
        this.width = width;
        this.height = height;
        this.imageData = new ImageData(width, height);
        this.pixels = new Uint32Array(this.imageData.data.buffer);
        this.markAllDirty();
    }

    // 左上をそろえて、はみ出した所は切り、増えた所は透明にする
    resize(width, height)
    {
        const oldPixels = this.pixels;
        const oldWidth = this.width;
        const copyWidth = Math.min(oldWidth, width);
        const copyHeight = Math.min(this.height, height);
        this.reset(width, height);
        for (let y = 0; y < copyHeight; y++) {
            const rowStart = y * oldWidth;
            this.pixels.set(oldPixels.subarray(rowStart, rowStart + copyWidth), y * width);
        }
    }

    loadImageData(imageData)
    {
        const { width, height, data } = imageData;
        this.reset(width, height);
        this.pixels.set(new Uint32Array(data.buffer, data.byteOffset, width * height));
    }

    isInside(x, y)
    {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    indexOf(x, y)
    {
        return y * this.width + x;
    }

    getPixel(x, y)
    {
        return this.pixels[this.indexOf(x, y)];
    }

    setPixelAt(index, color)
    {
        this.pixels[index] = color;
        this.extendDirty(index % this.width, Math.floor(index / this.width));
    }

    extendDirty(x, y)
    {
        const dirty = this.dirty;
        if (dirty === null) {
            this.dirty = { minX: x, minY: y, maxX: x, maxY: y };
            return;
        }
        dirty.minX = Math.min(dirty.minX, x);
        dirty.minY = Math.min(dirty.minY, y);
        dirty.maxX = Math.max(dirty.maxX, x);
        dirty.maxY = Math.max(dirty.maxY, y);
    }

    markDirtyRect(bounds)
    {
        this.extendDirty(bounds.minX, bounds.minY);
        this.extendDirty(bounds.maxX, bounds.maxY);
    }

    markAllDirty()
    {
        this.dirty = { minX: 0, minY: 0, maxX: this.width - 1, maxY: this.height - 1 };
    }

    // 変わった範囲を返して忘れる。何も変わっていなければ null
    takeDirtyRect()
    {
        const dirty = this.dirty;
        this.dirty = null;
        if (dirty === null) return null;
        return {
            x: dirty.minX,
            y: dirty.minY,
            width: dirty.maxX - dirty.minX + 1,
            height: dirty.maxY - dirty.minY + 1,
        };
    }
}
