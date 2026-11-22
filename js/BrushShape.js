'use strict';

const BrushShapeId = Object.freeze({
    Square: 'square',
    Round: 'round',
});

// 丸の半径をマス半分ぶんそのまま使うと、太さ 3 が四角と同じになる。少し削って 3 を十字にする
const kRoundRadiusShrink = 0.1;
const kCellCenterOffset = 0.5;

// 筆の形（太さぶんの正方形のうち、どのマスを塗るか）。形は横一列ずつ「左端〜右端」で持つ。
// 丸も四角も各行で塗るマスが1続きなので、これで足りる
class BrushShape
{
    // 太さ 64 の丸でも作るのは一瞬だが、カーソルの描画ごとに作り直さないよう覚えておく
    static cache = new Map();

    static get(shapeId, size)
    {
        const key = `${shapeId}:${size}`;
        let shape = BrushShape.cache.get(key);
        if (shape === undefined) {
            shape = new BrushShape(shapeId, size);
            BrushShape.cache.set(key, shape);
        }
        return shape;
    }

    constructor(shapeId, size)
    {
        this.shapeId = shapeId;
        this.size = size;
        // 太さが偶数のときは、カーソルのマスが中心より左上寄りになる
        this.start = Math.floor((size - 1) / 2);
        this.rows = shapeId === BrushShapeId.Round ? BrushShape.roundRows(size) : BrushShape.squareRows(size);
        this.outline = BrushShape.buildOutline(this.rows);
    }

    // rows[dy] = { left, right }（正方形の左上からのマス数）
    static squareRows(size)
    {
        return Array.from({ length: size }, () => ({ left: 0, right: size - 1 }));
    }

    // マスの中心が丸の中に入るかで決める。丸は左右対称なので、各行の左端だけ探せばよい
    static roundRows(size)
    {
        const center = size / 2;
        const radius = Math.max(kCellCenterOffset, center - kRoundRadiusShrink);
        const radiusSquared = radius * radius;
        const rows = [];
        for (let dy = 0; dy < size; dy++) {
            const offsetY = dy + kCellCenterOffset - center;
            let left = 0;
            while (left < center) {
                const offsetX = left + kCellCenterOffset - center;
                if (offsetX * offsetX + offsetY * offsetY <= radiusSquared) break;
                left++;
            }
            rows.push({ left, right: size - 1 - left });
        }
        return rows;
    }

    static isFilled(rows, dx, dy)
    {
        if (dy < 0 || dy >= rows.length) return false;
        return dx >= rows[dy].left && dx <= rows[dy].right;
    }

    // カーソルの枠の線分 [x0, y0, x1, y1]（マス単位）。塗るマスと塗らないマスの境目だけ引く
    static buildOutline(rows)
    {
        const segments = [];
        for (let dy = 0; dy < rows.length; dy++) {
            const { left, right } = rows[dy];
            segments.push([left, dy, left, dy + 1], [right + 1, dy, right + 1, dy + 1]);
            for (let dx = left; dx <= right; dx++) {
                if (!BrushShape.isFilled(rows, dx, dy - 1)) segments.push([dx, dy, dx + 1, dy]);
                if (!BrushShape.isFilled(rows, dx, dy + 1)) segments.push([dx, dy + 1, dx + 1, dy + 1]);
            }
        }
        return segments;
    }
}
