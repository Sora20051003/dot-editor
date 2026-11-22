'use strict';

const kHueMax = 360;
const kHueStops = 6;
const kPickerMarkerRadius = 6;
const kPickerMarkerInner = '#ffffff';
const kPickerMarkerOuter = '#000000';
const kAlphaCheckerCss = 6;
const kAlphaCheckerLight = '#ffffff';
const kAlphaCheckerDark = '#c8c8c8';

// 色を細かく選ぶ部品。四角（横＝鮮やかさ、縦＝明るさ）と、色合い（色相）の帯をドラッグして選ぶ。
// 色相・鮮やかさは自分で覚えておく（灰色や黒を選んでも、色相が 0 に戻ってしまわないように）
class ColorPicker
{
    // onPick(color): ドラッグで色が変わったとき。
    // hasAlpha が true なら透明度の帯も出す。false なら透明度は setColor で受け取った値を使う
    constructor(container, onPick, hasAlpha = false)
    {
        this.onPick = onPick;
        this.hasAlpha = hasAlpha;
        this.hue = 0;
        this.saturation = 0;
        this.value = 0;
        this.alpha = ColorUtil.kChannelMax;
        this.lastColor = null;
        this.square = ColorPicker.createCanvas(container, 'picker-square', '鮮やかさ（横）と明るさ（縦）');
        this.hueBar = ColorPicker.createCanvas(container, 'picker-hue', '色合い');
        this.bindDrag(this.square, (x, y) => {
            this.saturation = x;
            this.value = 1 - y;
        });
        this.bindDrag(this.hueBar, (x) => {
            this.hue = x * kHueMax;
        });
        this.alphaBar = hasAlpha ? ColorPicker.createCanvas(container, 'picker-alpha', '透明度') : null;
        if (hasAlpha) {
            this.bindDrag(this.alphaBar, (x) => {
                this.alpha = Math.round(x * ColorUtil.kChannelMax);
            });
        }
        new ResizeObserver(() => this.render()).observe(this.square);
    }

    static createCanvas(container, className, label)
    {
        const canvas = document.createElement('canvas');
        canvas.className = className;
        canvas.setAttribute('aria-label', label);
        canvas.style.touchAction = 'none';
        container.appendChild(canvas);
        return canvas;
    }

    // 外（パレット・色コードなど）で色が変わったときに印を動かす。自分が出した色なら何もしない
    setColor(color)
    {
        if (color === this.lastColor) return;
        this.lastColor = color;
        const { a } = ColorUtil.unpack(color);
        // 透明度の帯がないときは、透明のまま選ぶと何も見えないので不透明にする
        this.alpha = this.hasAlpha || a !== 0 ? a : ColorUtil.kChannelMax;
        const hsv = ColorUtil.toHsv(color);
        if (hsv.v > 0 && hsv.s > 0) this.hue = hsv.h;
        if (hsv.v > 0) this.saturation = hsv.s;
        this.value = hsv.v;
        this.render();
    }

    // 押した場所の割合（0〜1）を apply に渡す。押したまま外へ出ても端の値で続ける
    bindDrag(canvas, apply)
    {
        const update = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
            apply(x, y);
            this.emit();
        };
        canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            canvas.setPointerCapture(e.pointerId);
            update(e);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (canvas.hasPointerCapture(e.pointerId)) update(e);
        });
    }

    emit()
    {
        const color = ColorUtil.fromHsv(this.hue, this.saturation, this.value, this.alpha);
        this.lastColor = color;
        this.render();
        this.onPick(color);
    }

    render()
    {
        this.renderSquare();
        this.renderHueBar();
        if (this.hasAlpha) this.renderAlphaBar();
    }

    static fitCanvas(canvas)
    {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        return { ctx: canvas.getContext('2d'), width, height, dpr };
    }

    // 色相の純色の上に、左から白、上から黒のグラデーションを重ねる
    renderSquare()
    {
        const { ctx, width, height, dpr } = ColorPicker.fitCanvas(this.square);
        ctx.fillStyle = ColorUtil.toCss(ColorUtil.fromHsv(this.hue, 1, 1));
        ctx.fillRect(0, 0, width, height);
        const white = ctx.createLinearGradient(0, 0, width, 0);
        white.addColorStop(0, '#ffffff');
        white.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = white;
        ctx.fillRect(0, 0, width, height);
        const black = ctx.createLinearGradient(0, 0, 0, height);
        black.addColorStop(0, 'rgba(0, 0, 0, 0)');
        black.addColorStop(1, '#000000');
        ctx.fillStyle = black;
        ctx.fillRect(0, 0, width, height);
        ColorPicker.drawMarker(ctx, this.saturation * width, (1 - this.value) * height, dpr);
    }

    renderHueBar()
    {
        const { ctx, width, height, dpr } = ColorPicker.fitCanvas(this.hueBar);
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        for (let i = 0; i <= kHueStops; i++) {
            gradient.addColorStop(i / kHueStops, ColorUtil.toCss(ColorUtil.fromHsv((kHueMax * i) / kHueStops, 1, 1)));
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ColorPicker.drawMarker(ctx, (this.hue / kHueMax) * width, height / 2, dpr);
    }

    // 市松模様の上に「透明 → 今の色（不透明）」のグラデーション。透けて見えることが分かるように
    renderAlphaBar()
    {
        const { ctx, width, height, dpr } = ColorPicker.fitCanvas(this.alphaBar);
        const cell = kAlphaCheckerCss * dpr;
        for (let y = 0; y < height; y += cell) {
            for (let x = 0; x < width; x += cell) {
                const isDark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 1;
                ctx.fillStyle = isDark ? kAlphaCheckerDark : kAlphaCheckerLight;
                ctx.fillRect(x, y, cell, cell);
            }
        }
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, ColorUtil.toCss(ColorUtil.fromHsv(this.hue, this.saturation, this.value, 0)));
        gradient.addColorStop(1, ColorUtil.toCss(ColorUtil.fromHsv(this.hue, this.saturation, this.value)));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ColorPicker.drawMarker(ctx, (this.alpha / ColorUtil.kChannelMax) * width, height / 2, dpr);
    }

    // 白黒二重の丸。どんな色の上でも見えるように
    static drawMarker(ctx, x, y, dpr)
    {
        ctx.beginPath();
        ctx.arc(x, y, kPickerMarkerRadius * dpr, 0, Math.PI * 2);
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = kPickerMarkerOuter;
        ctx.stroke();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = kPickerMarkerInner;
        ctx.stroke();
    }
}
