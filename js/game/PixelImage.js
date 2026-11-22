'use strict';

// 通信モードで使える絵の大きさ。大きくすると送る量が増えるので 64 マスまでにする
const kGameCanvasSizes = Object.freeze([16, 32, 64]);
const kGameRgbaBytes = 4;
const kBlankColor = ColorUtil.pack(255, 255, 255, 255);

// 通信モードの絵（正方形・不透明）。送るときは gzip して base64 にする
const PixelImage = {
    isValidSize(size)
    {
        return kGameCanvasSizes.includes(size);
    },

    createBlank(size)
    {
        return new Uint32Array(size * size).fill(kBlankColor);
    },

    // 戻り値 { size, data } がそのままメッセージに入る形
    async encode(pixels, size)
    {
        const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, size * size * kGameRgbaBytes);
        return { size, data: await ByteCodec.gzipToBase64(bytes) };
    },

    // 相手から届いた絵を読む。大きさが決めたものと違う・壊れているときは null
    async decode(image, expectedSize)
    {
        if (image === null || typeof image !== 'object') return null;
        if (image.size !== expectedSize || typeof image.data !== 'string') return null;
        try {
            const bytes = await ByteCodec.base64ToGunzip(image.data);
            if (bytes.length !== expectedSize * expectedSize * kGameRgbaBytes) return null;
            return new Uint32Array(bytes.buffer, bytes.byteOffset, expectedSize * expectedSize);
        } catch (error) {
            return null;
        }
    },

    // だんだんクイズで見せる細かさ：1×1, 2×2, 4×4 … 元の大きさ
    revealSteps(size)
    {
        const steps = [];
        for (let cells = 1; cells <= size; cells *= 2) steps.push(cells);
        return steps;
    },

    // cells×cells のブロックに分け、ブロックごとの平均の色で塗った絵を作る（大きさは元と同じ）
    mosaic(pixels, size, cells)
    {
        const blockSize = size / cells;
        const result = new Uint32Array(size * size);
        for (let blockY = 0; blockY < cells; blockY++) {
            for (let blockX = 0; blockX < cells; blockX++) {
                const color = PixelImage.averageBlock(pixels, size, blockX * blockSize, blockY * blockSize, blockSize);
                PixelImage.fillBlock(result, size, blockX * blockSize, blockY * blockSize, blockSize, color);
            }
        }
        return result;
    },

    averageBlock(pixels, size, left, top, blockSize)
    {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let y = top; y < top + blockSize; y++) {
            for (let x = left; x < left + blockSize; x++) {
                const { r, g, b } = ColorUtil.unpack(pixels[y * size + x]);
                red += r;
                green += g;
                blue += b;
            }
        }
        const count = blockSize * blockSize;
        return ColorUtil.pack(Math.round(red / count), Math.round(green / count), Math.round(blue / count), ColorUtil.kChannelMax);
    },

    fillBlock(target, size, left, top, blockSize, color)
    {
        for (let y = top; y < top + blockSize; y++) {
            target.fill(color, y * size + left, y * size + left + blockSize);
        }
    },
};
