'use strict';

// 1マスが何 px に見えるか。整数倍のほうがマスの大きさがそろって見やすい
const kZoomLevels = [
    0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10,
    12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256,
];
const kMinZoom = kZoomLevels[0];
const kMaxZoom = kZoomLevels[kZoomLevels.length - 1];
const kZoomEpsilon = 1e-6;
// これより小さいマスに線を引くと線だけで埋まって絵が見えなくなる
const kGridMinCellCss = 6;
const kFitMargin = 0.9;
const kCheckerCellCss = 8;
const kCheckerLight = '#ececec';
const kCheckerDark = '#d6d6d6';
const kGridColor = 'rgba(128, 128, 128, 0.55)';
const kMajorGridColor = 'rgba(70, 150, 255, 0.9)';
const kBorderColor = 'rgba(0, 0, 0, 0.7)';
const kCursorOuterColor = '#000000';
const kCursorInnerColor = '#ffffff';

// 絵を画面に表示する。ズーム・スクロール位置と、画面座標からマス座標への変換を持つ
class ViewRenderer
{
    constructor(canvas, container)
    {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.container = container;
        // レイヤーごとの表示用画像。重ねるのはブラウザに任せる（自前で混ぜるより速い）
        this.layerSurfaces = new Map();
        this.zoom = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.viewWidth = 0;
        this.viewHeight = 0;
        this.dpr = 1;
        this.isGridVisible = true;
        this.majorGridStep = 0;
        this.checkerPattern = null;
        this.backgroundColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--stage-bg')
            .trim();
    }

    resizeToContainer()
    {
        const rect = this.container.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        this.viewWidth = rect.width;
        this.viewHeight = rect.height;
        this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
    }

    fitTo(width, height)
    {
        const fitZoom = Math.min(this.viewWidth / width, this.viewHeight / height) * kFitMargin;
        // 等倍以上は整数倍にして、どのマスも同じ大きさに見えるようにする
        const roundedZoom = fitZoom >= 1 ? Math.floor(fitZoom) : fitZoom;
        this.zoom = Math.min(kMaxZoom, Math.max(kMinZoom, roundedZoom));
        this.offsetX = this.snapToDevice((this.viewWidth - width * this.zoom) / 2);
        this.offsetY = this.snapToDevice((this.viewHeight - height * this.zoom) / 2);
    }

    // 指定した画面上の点の下にあるマスが動かないようにズームする
    zoomAt(newZoom, cssX, cssY)
    {
        const zoom = Math.min(kMaxZoom, Math.max(kMinZoom, newZoom));
        const cellX = (cssX - this.offsetX) / this.zoom;
        const cellY = (cssY - this.offsetY) / this.zoom;
        this.zoom = zoom;
        this.offsetX = this.snapToDevice(cssX - cellX * zoom);
        this.offsetY = this.snapToDevice(cssY - cellY * zoom);
    }

    stepZoom(direction, cssX, cssY)
    {
        const next =
            direction > 0
                ? kZoomLevels.find((z) => z > this.zoom + kZoomEpsilon)
                : [...kZoomLevels].reverse().find((z) => z < this.zoom - kZoomEpsilon);
        if (next === undefined) return;
        this.zoomAt(next, cssX, cssY);
    }

    stepZoomAtCenter(direction)
    {
        this.stepZoom(direction, this.viewWidth / 2, this.viewHeight / 2);
    }

    panBy(dx, dy)
    {
        this.offsetX = this.snapToDevice(this.offsetX + dx);
        this.offsetY = this.snapToDevice(this.offsetY + dy);
    }

    toPixel(cssX, cssY)
    {
        return {
            x: Math.floor((cssX - this.offsetX) / this.zoom),
            y: Math.floor((cssY - this.offsetY) / this.zoom),
        };
    }

    // 画面の端数ピクセルにまたがるとマスの境目がにじむので、実ピクセルにそろえる
    snapToDevice(value)
    {
        return Math.round(value * this.dpr) / this.dpr;
    }

    syncDirty(layers)
    {
        const liveIds = new Set();
        for (const layer of layers.layers) {
            liveIds.add(layer.id);
            this.syncLayer(layer);
        }
        for (const id of [...this.layerSurfaces.keys()]) {
            if (!liveIds.has(id)) this.layerSurfaces.delete(id);
        }
    }

    // 変わった範囲だけ表示用画像へ送る
    syncLayer(layer)
    {
        const pixelCanvas = layer.canvas;
        const surface = this.getSurface(layer.id);
        const isResized =
            surface.canvas.width !== pixelCanvas.width || surface.canvas.height !== pixelCanvas.height;
        if (isResized) {
            surface.canvas.width = pixelCanvas.width;
            surface.canvas.height = pixelCanvas.height;
            pixelCanvas.markAllDirty();
        }
        const rect = pixelCanvas.takeDirtyRect();
        if (rect === null) return;
        surface.ctx.putImageData(pixelCanvas.imageData, 0, 0, rect.x, rect.y, rect.width, rect.height);
    }

    getSurface(layerId)
    {
        let surface = this.layerSurfaces.get(layerId);
        if (surface === undefined) {
            const canvas = document.createElement('canvas');
            canvas.width = 0;
            surface = { canvas, ctx: canvas.getContext('2d') };
            this.layerSurfaces.set(layerId, surface);
        }
        return surface;
    }

    // layers は LayerStack
    render(layers, cursor)
    {
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;

        const range = this.visibleRange(layers);
        if (range !== null) {
            this.drawChecker(range);
            this.drawLayers(range, layers);
            this.drawGrids(range);
        }
        this.drawBorder(layers);
        if (cursor !== null) this.drawCursor(cursor);
    }

    // 画面に見えているマスの範囲だけ描く（4096 マスでも重くしないため）
    visibleRange(pixelCanvas)
    {
        const x0 = Math.max(0, Math.floor(-this.offsetX / this.zoom));
        const y0 = Math.max(0, Math.floor(-this.offsetY / this.zoom));
        const x1 = Math.min(pixelCanvas.width, Math.ceil((this.viewWidth - this.offsetX) / this.zoom));
        const y1 = Math.min(pixelCanvas.height, Math.ceil((this.viewHeight - this.offsetY) / this.zoom));
        if (x1 <= x0 || y1 <= y0) return null;
        return { x0, y0, x1, y1 };
    }

    cellToCssX(cellX)
    {
        return this.offsetX + cellX * this.zoom;
    }

    cellToCssY(cellY)
    {
        return this.offsetY + cellY * this.zoom;
    }

    rangeToCssRect(range)
    {
        const left = this.cellToCssX(range.x0);
        const top = this.cellToCssY(range.y0);
        return { left, top, width: this.cellToCssX(range.x1) - left, height: this.cellToCssY(range.y1) - top };
    }

    drawChecker(range)
    {
        if (this.checkerPattern === null) this.checkerPattern = this.createCheckerPattern();
        const rect = this.rangeToCssRect(range);
        this.ctx.fillStyle = this.checkerPattern;
        this.ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    }

    createCheckerPattern()
    {
        const tile = document.createElement('canvas');
        tile.width = kCheckerCellCss * 2;
        tile.height = kCheckerCellCss * 2;
        const tileCtx = tile.getContext('2d');
        tileCtx.fillStyle = kCheckerLight;
        tileCtx.fillRect(0, 0, tile.width, tile.height);
        tileCtx.fillStyle = kCheckerDark;
        tileCtx.fillRect(0, 0, kCheckerCellCss, kCheckerCellCss);
        tileCtx.fillRect(kCheckerCellCss, kCheckerCellCss, kCheckerCellCss, kCheckerCellCss);
        return this.ctx.createPattern(tile, 'repeat');
    }

    // 下のレイヤーから順に、不透明度を付けて重ねる
    drawLayers(range, layers)
    {
        const ctx = this.ctx;
        const rect = this.rangeToCssRect(range);
        const cellsX = range.x1 - range.x0;
        const cellsY = range.y1 - range.y0;
        for (const layer of layers.visibleLayers()) {
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(
                this.getSurface(layer.id).canvas, range.x0, range.y0, cellsX, cellsY,
                rect.left, rect.top, rect.width, rect.height);
        }
        ctx.globalAlpha = 1;
    }

    drawGrids(range)
    {
        if (this.isGridVisible) this.drawGridLines(range, 1, kGridColor);
        if (this.majorGridStep > 0) this.drawGridLines(range, this.majorGridStep, kMajorGridColor);
    }

    drawGridLines(range, step, color)
    {
        if (this.zoom * step < kGridMinCellCss) return;
        const ctx = this.ctx;
        const rect = this.rangeToCssRect(range);
        ctx.beginPath();
        for (let x = Math.ceil(range.x0 / step) * step; x <= range.x1; x += step) {
            const lineX = this.snapLine(this.cellToCssX(x));
            ctx.moveTo(lineX, rect.top);
            ctx.lineTo(lineX, rect.top + rect.height);
        }
        for (let y = Math.ceil(range.y0 / step) * step; y <= range.y1; y += step) {
            const lineY = this.snapLine(this.cellToCssY(y));
            ctx.moveTo(rect.left, lineY);
            ctx.lineTo(rect.left + rect.width, lineY);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 / this.dpr;
        ctx.stroke();
    }

    // 1px の線は実ピクセルの中央に置かないと 2px にぼやける
    snapLine(value)
    {
        return (Math.round(value * this.dpr) + 0.5) / this.dpr;
    }

    drawBorder(pixelCanvas)
    {
        const ctx = this.ctx;
        ctx.strokeStyle = kBorderColor;
        ctx.lineWidth = 1 / this.dpr;
        ctx.strokeRect(
            this.snapLine(this.offsetX) - 1 / this.dpr,
            this.snapLine(this.offsetY) - 1 / this.dpr,
            pixelCanvas.width * this.zoom + 1 / this.dpr,
            pixelCanvas.height * this.zoom + 1 / this.dpr);
    }

    // cursor は { x, y, brush }。筆の形の枠を白黒二重で描いて、どんな色の上でも見えるようにする
    drawCursor(cursor)
    {
        const brush = cursor.brush;
        const originX = cursor.x - brush.start;
        const originY = cursor.y - brush.start;
        const ctx = this.ctx;
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of brush.outline) {
            ctx.moveTo(this.cellToCssX(originX + x0), this.cellToCssY(originY + y0));
            ctx.lineTo(this.cellToCssX(originX + x1), this.cellToCssY(originY + y1));
        }
        ctx.lineCap = 'square';
        ctx.lineWidth = 3 / this.dpr;
        ctx.strokeStyle = kCursorOuterColor;
        ctx.stroke();
        ctx.lineWidth = 1 / this.dpr;
        ctx.strokeStyle = kCursorInnerColor;
        ctx.stroke();
        // 角のつなぎ目を埋めるための設定なので、他の線に残さない
        ctx.lineCap = 'butt';
    }
}
