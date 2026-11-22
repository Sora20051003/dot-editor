'use strict';

// 受け取った絵を <canvas> に表示する。キャンバスは絵と同じマス数にして、拡大は CSS（pixelated）に任せる
const PixelImageView = {
    draw(canvas, pixels, size)
    {
        canvas.width = size;
        canvas.height = size;
        const source = pixels === null ? PixelImage.createBlank(size) : pixels;
        const bytes = new Uint8ClampedArray(source.buffer, source.byteOffset, size * size * kGameRgbaBytes);
        canvas.getContext('2d').putImageData(new ImageData(bytes, size, size), 0, 0);
    },

    createCanvas(className)
    {
        const canvas = document.createElement('canvas');
        canvas.className = className;
        return canvas;
    },

    // 送られてきた形のまま表示する。読めない絵は白紙で出す
    async drawEncoded(canvas, image, size)
    {
        const pixels = image === null || image === undefined ? null : await PixelImage.decode(image, size);
        PixelImageView.draw(canvas, pixels, size);
    },
};
