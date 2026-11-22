'use strict';

// マスを塗る処理（点・線・四角・塗りつぶし・反転）。塗る前の色は必ず EditHistory に記録する。
// 塗る先はいつも「今選んでいるレイヤー」
class Painter
{
    constructor(layers, history)
    {
        this.layers = layers;
        this.history = history;
    }

    get canvas()
    {
        return this.layers.activeCanvas;
    }

    plot(x, y, color)
    {
        if (!this.canvas.isInside(x, y)) return;
        this.plotIndex(this.canvas.indexOf(x, y), color);
    }

    plotIndex(index, color)
    {
        const oldColor = this.canvas.pixels[index];
        if (oldColor === color) return;
        this.history.record(index, oldColor);
        this.canvas.setPixelAt(index, color);
    }

    // brush は BrushShape。(x, y) のマスを筆の中心として、その形のマスを塗る
    stamp(x, y, brush, color)
    {
        const startX = x - brush.start;
        const startY = y - brush.start;
        for (let dy = 0; dy < brush.rows.length; dy++) {
            const { left, right } = brush.rows[dy];
            for (let dx = left; dx <= right; dx++) this.plot(startX + dx, startY + dy, color);
        }
    }

    strokeLine(x0, y0, x1, y1, brush, color)
    {
        Painter.forEachLinePoint(x0, y0, x1, y1, (x, y) => this.stamp(x, y, brush, color));
    }

    rect(x0, y0, x1, y1, brush, color, isFilled)
    {
        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        if (isFilled) {
            this.fillRect(minX, minY, maxX, maxY, color);
            return;
        }
        this.strokeLine(minX, minY, maxX, minY, brush, color);
        this.strokeLine(maxX, minY, maxX, maxY, brush, color);
        this.strokeLine(maxX, maxY, minX, maxY, brush, color);
        this.strokeLine(minX, maxY, minX, minY, brush, color);
    }

    // 絵の外まで回ると無駄なので、絵の範囲に切ってから塗る
    fillRect(minX, minY, maxX, maxY, color)
    {
        const left = Math.max(0, minX);
        const top = Math.max(0, minY);
        const right = Math.min(this.canvas.width - 1, maxX);
        const bottom = Math.min(this.canvas.height - 1, maxY);
        if (left > right) return;
        for (let y = top; y <= bottom; y++) this.paintRun(y, left, right, color);
    }

    // 1マスずつ書き換え範囲を広げると大きな塗りつぶしで遅いので、横一列まとめて扱う
    paintRun(y, left, right, color)
    {
        const pixels = this.canvas.pixels;
        const rowStart = y * this.canvas.width;
        for (let index = rowStart + left; index <= rowStart + right; index++) {
            const oldColor = pixels[index];
            if (oldColor === color) continue;
            this.history.record(index, oldColor);
            pixels[index] = color;
        }
        this.canvas.extendDirty(left, y);
        this.canvas.extendDirty(right, y);
    }

    // 絵全体の左右反転。左右の端から対になるマスを入れ替える
    flipHorizontal()
    {
        const { width, height } = this.canvas;
        const halfWidth = Math.floor(width / 2);
        for (let y = 0; y < height; y++) {
            const rowStart = y * width;
            for (let x = 0; x < halfWidth; x++) this.swapPixels(rowStart + x, rowStart + width - 1 - x);
        }
        this.canvas.markAllDirty();
    }

    // 絵全体の上下反転。上下の端から対になる行を入れ替える
    flipVertical()
    {
        const { width, height } = this.canvas;
        const halfHeight = Math.floor(height / 2);
        for (let y = 0; y < halfHeight; y++) {
            const topStart = y * width;
            const bottomStart = (height - 1 - y) * width;
            for (let x = 0; x < width; x++) this.swapPixels(topStart + x, bottomStart + x);
        }
        this.canvas.markAllDirty();
    }

    // 同じ色どうしは入れ替えても変わらないので、取り消し履歴に記録しない
    swapPixels(indexA, indexB)
    {
        const pixels = this.canvas.pixels;
        const colorA = pixels[indexA];
        const colorB = pixels[indexB];
        if (colorA === colorB) return;
        this.history.record(indexA, colorA);
        this.history.record(indexB, colorB);
        pixels[indexA] = colorB;
        pixels[indexB] = colorA;
    }

    // 横一列ずつ塗るやり方。1マスずつ再帰すると大きい絵でスタックがあふれる
    floodFill(startX, startY, color)
    {
        if (!this.canvas.isInside(startX, startY)) return;
        const target = this.canvas.getPixel(startX, startY);
        if (target === color) return;

        const seeds = [startX, startY];
        while (seeds.length > 0) {
            const y = seeds.pop();
            const x = seeds.pop();
            if (this.canvas.getPixel(x, y) !== target) continue;
            const span = this.fillSpan(x, y, target, color);
            this.pushSpanSeeds(seeds, span, y - 1, target);
            this.pushSpanSeeds(seeds, span, y + 1, target);
        }
    }

    fillSpan(x, y, target, color)
    {
        const pixels = this.canvas.pixels;
        const rowStart = y * this.canvas.width;
        let left = x;
        while (left > 0 && pixels[rowStart + left - 1] === target) left--;
        let right = x;
        while (right < this.canvas.width - 1 && pixels[rowStart + right + 1] === target) right++;
        this.paintRun(y, left, right, color);
        return { left, right };
    }

    pushSpanSeeds(seeds, span, y, target)
    {
        if (y < 0 || y >= this.canvas.height) return;
        const pixels = this.canvas.pixels;
        const rowStart = y * this.canvas.width;
        let isInRun = false;
        for (let x = span.left; x <= span.right; x++) {
            const isTarget = pixels[rowStart + x] === target;
            if (isTarget && !isInRun) seeds.push(x, y);
            isInRun = isTarget;
        }
    }

    // ブレゼンハムの線分。マウスを速く動かしても線が途切れないようにする
    static forEachLinePoint(x0, y0, x1, y1, callback)
    {
        const dx = Math.abs(x1 - x0);
        const dy = -Math.abs(y1 - y0);
        const stepX = x0 < x1 ? 1 : -1;
        const stepY = y0 < y1 ? 1 : -1;
        let error = dx + dy;
        let x = x0;
        let y = y0;
        for (;;) {
            callback(x, y);
            if (x === x1 && y === y1) return;
            const doubled = 2 * error;
            if (doubled >= dy) {
                error += dy;
                x += stepX;
            }
            if (doubled <= dx) {
                error += dx;
                y += stepY;
            }
        }
    }
}
