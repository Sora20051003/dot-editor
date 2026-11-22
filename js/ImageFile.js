'use strict';

const kMaxCanvasSize = 4096;
// ブラウザが作れるキャンバスの1辺の上限（Chrome / Edge）
const kMaxExportSide = 16384;
const kRevokeDelayMs = 1000;

// PNG の読み込みと保存
const ImageFile = {
    async readImage(file)
    {
        const bitmap = await createImageBitmap(file, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
        });
        const { width, height } = bitmap;
        if (width > kMaxCanvasSize || height > kMaxCanvasSize) {
            bitmap.close();
            throw new Error(`画像が大きすぎます（${width}×${height}）。${kMaxCanvasSize}×${kMaxCanvasSize} までです`);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, width, height);
    },

    // scale 倍に拡大して保存する。ドット絵は小さいままだと SNS などでぼやけるため
    // 見えているレイヤーだけを重ねた1枚で保存する
    async savePng(layers, scale, fileName)
    {
        const width = layers.width * scale;
        const height = layers.height * scale;
        if (width > kMaxExportSide || height > kMaxExportSide) {
            throw new Error(`倍率が大きすぎます（${width}×${height}）。1辺 ${kMaxExportSide} までです`);
        }
        const canvas = ImageFile.createScaledCanvas(ImageFile.composeLayers(layers), scale);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob === null) throw new Error('PNG を作れませんでした');
        ImageFile.download(blob, fileName);
    },

    composeLayers(layers)
    {
        const composed = ImageFile.createCanvas(layers.width, layers.height);
        const ctx = composed.getContext('2d');
        const visible = layers.visibleLayers();
        // 1枚だけで不透明度 100% なら、色をそのまま写して半透明の色の誤差を出さない
        if (visible.length === 1 && visible[0].opacity === 1) {
            ctx.putImageData(visible[0].canvas.imageData, 0, 0);
            return composed;
        }
        const layerCanvas = ImageFile.createCanvas(layers.width, layers.height);
        const layerCtx = layerCanvas.getContext('2d');
        for (const layer of visible) {
            layerCtx.putImageData(layer.canvas.imageData, 0, 0);
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(layerCanvas, 0, 0);
        }
        return composed;
    },

    createScaledCanvas(source, scale)
    {
        if (scale === 1) return source;
        const scaled = ImageFile.createCanvas(source.width * scale, source.height * scale);
        const ctx = scaled.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
        return scaled;
    },

    createCanvas(width, height)
    {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    },

    download(blob, fileName)
    {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), kRevokeDelayMs);
    },
};
