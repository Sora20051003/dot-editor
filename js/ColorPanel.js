'use strict';

const kPresetHueCount = 12;
const kFullCircleDegrees = 360;
const kPresetSaturation = 0.72;
const kPresetLightness = [0.2, 0.34, 0.48, 0.62, 0.76, 0.88];
const kPresetGrayCount = 12;
const kRecentColorMax = 24;
const kMyPaletteMax = 96;
const kMyPaletteStorageKey = 'dotEditor.myPalette';
const kSlotPrimary = 0;
const kSlotSecondary = 1;

// 色の選択欄。左クリック用・右クリック用の2色を持ち、
// 「コードで選ぶ」（#RRGGBB や RGBA の数値）と「表から選ぶ」（パレット）の両方で変えられる
class ColorPanel
{
    constructor(onChange)
    {
        this.onChange = onChange;
        this.colors = [ColorUtil.pack(0, 0, 0, 255), ColorUtil.pack(255, 255, 255, 255)];
        this.activeSlot = kSlotPrimary;
        this.recentColors = [];
        this.myPalette = ColorPanel.loadMyPalette();
        this.el = ColorPanel.findElements();
        this.picker = new ColorPicker(this.el.pickerHost, (color) => this.setActiveColor(color, 'picker'), true);
        this.bindEvents();
        this.fillPalette(this.el.presetPalette, ColorPanel.buildPresetColors(), false);
        this.renderMyPalette();
        this.renderRecent();
        this.refresh(null);
    }

    static findElements()
    {
        const byId = (id) => document.getElementById(id);
        return {
            slots: [byId('slotPrimary'), byId('slotSecondary')],
            swatches: [byId('swatchPrimary'), byId('swatchSecondary')],
            swap: byId('btnSwap'),
            code: byId('colorCode'),
            codeApply: byId('btnApplyCode'),
            codeError: byId('codeError'),
            channels: [byId('inR'), byId('inG'), byId('inB'), byId('inA')],
            native: byId('nativePicker'),
            presetPalette: byId('presetPalette'),
            myPalette: byId('myPalette'),
            addMy: byId('btnAddMy'),
            recentPalette: byId('recentPalette'),
            pickerHost: byId('colorPicker'),
        };
    }

    bindEvents()
    {
        const el = this.el;
        el.slots.forEach((slot, index) => slot.addEventListener('click', () => this.selectSlot(index)));
        el.swap.addEventListener('click', () => this.swap());
        el.code.addEventListener('input', () => this.previewCode());
        el.code.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.applyCode();
        });
        el.code.addEventListener('change', () => this.applyCode());
        el.codeApply.addEventListener('click', () => this.applyCode());
        el.channels.forEach((input) => input.addEventListener('input', () => this.applyChannels()));
        el.native.addEventListener('input', () => this.applyNative());
        el.addMy.addEventListener('click', () => this.addToMyPalette(this.getActiveColor()));
    }

    getColor(isSecondary)
    {
        return this.colors[isSecondary ? kSlotSecondary : kSlotPrimary];
    }

    getActiveColor()
    {
        return this.colors[this.activeSlot];
    }

    setColor(isSecondary, color)
    {
        this.colors[isSecondary ? kSlotSecondary : kSlotPrimary] = color;
        this.refresh(null);
        this.onChange();
    }

    // skipField には今まさに入力中の欄を渡す。打っている途中の文字を書き換えないため
    setActiveColor(color, skipField)
    {
        this.colors[this.activeSlot] = color;
        this.refresh(skipField);
        this.onChange();
    }

    selectSlot(slot)
    {
        this.activeSlot = slot;
        this.refresh(null);
    }

    swap()
    {
        this.colors.reverse();
        this.refresh(null);
        this.onChange();
    }

    previewCode()
    {
        const color = ColorUtil.parseCode(this.el.code.value);
        if (color === null) return;
        this.el.codeError.textContent = '';
        this.setActiveColor(color, 'code');
    }

    applyCode()
    {
        const color = ColorUtil.parseCode(this.el.code.value);
        if (color === null) {
            this.el.codeError.textContent = '読めないコードです（例：#FF8800、#F80、255,136,0）';
            return;
        }
        this.el.codeError.textContent = '';
        this.setActiveColor(color, null);
    }

    applyChannels()
    {
        const values = this.el.channels.map((input) => {
            const value = Math.round(Number(input.value));
            return Number.isFinite(value) ? Math.min(ColorUtil.kChannelMax, Math.max(0, value)) : 0;
        });
        this.setActiveColor(ColorUtil.pack(...values), 'channels');
    }

    // OS の色選択は透明度を選べないので、今の透明度を引き継ぐ。透明だと見えないので不透明にする
    applyNative()
    {
        const picked = ColorUtil.parseCode(this.el.native.value);
        if (picked === null) return;
        const alpha = ColorUtil.unpack(this.getActiveColor()).a || ColorUtil.kChannelMax;
        const c = ColorUtil.unpack(picked);
        this.setActiveColor(ColorUtil.pack(c.r, c.g, c.b, alpha), 'native');
    }

    refresh(skipField)
    {
        const el = this.el;
        el.slots.forEach((slot, index) => slot.classList.toggle('is-active', index === this.activeSlot));
        el.swatches.forEach((swatch, index) => ColorPanel.paintChip(swatch, this.colors[index]));
        const color = this.getActiveColor();
        if (skipField !== 'code') {
            el.code.value = ColorUtil.toHex(color);
            el.codeError.textContent = '';
        }
        if (skipField !== 'channels') {
            const c = ColorUtil.unpack(color);
            [c.r, c.g, c.b, c.a].forEach((value, index) => (el.channels[index].value = value));
        }
        if (skipField !== 'native') el.native.value = ColorUtil.toRgbHex(color);
        // 自分が出した色なら ColorPicker 側で何もしないので、いつも渡してよい
        this.picker.setColor(color);
    }

    addRecent(color)
    {
        this.recentColors = [color, ...this.recentColors.filter((c) => c !== color)].slice(0, kRecentColorMax);
        this.renderRecent();
    }

    addToMyPalette(color)
    {
        if (this.myPalette.includes(color)) return;
        this.myPalette = [...this.myPalette, color].slice(-kMyPaletteMax);
        this.saveMyPalette();
        this.renderMyPalette();
    }

    removeFromMyPalette(color)
    {
        this.myPalette = this.myPalette.filter((c) => c !== color);
        this.saveMyPalette();
        this.renderMyPalette();
    }

    renderMyPalette()
    {
        this.fillPalette(this.el.myPalette, this.myPalette, true);
    }

    renderRecent()
    {
        this.fillPalette(this.el.recentPalette, this.recentColors, false);
    }

    fillPalette(container, colors, isRemovable)
    {
        container.replaceChildren(...colors.map((color) => this.createPaletteCell(color, isRemovable)));
    }

    createPaletteCell(color, isRemovable)
    {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'chip palette-cell';
        cell.title = ColorUtil.toHex(color);
        ColorPanel.paintChip(cell, color);
        cell.addEventListener('click', (e) => {
            if (isRemovable && e.ctrlKey) {
                this.removeFromMyPalette(color);
                return;
            }
            this.setColor(false, color);
        });
        cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.setColor(true, color);
        });
        return cell;
    }

    // チェック柄の上に色を重ねて、透明・半透明も分かるようにする
    static paintChip(element, color)
    {
        const css = ColorUtil.toCss(color);
        element.style.setProperty('--chip-color', css);
    }

    static buildPresetColors()
    {
        const colors = [ColorUtil.kTransparent];
        for (let i = 0; i < kPresetGrayCount - 1; i++) {
            const value = Math.round((ColorUtil.kChannelMax * i) / (kPresetGrayCount - 2));
            colors.push(ColorUtil.pack(value, value, value, ColorUtil.kChannelMax));
        }
        for (const lightness of kPresetLightness) {
            for (let i = 0; i < kPresetHueCount; i++) {
                const hue = (kFullCircleDegrees * i) / kPresetHueCount;
                colors.push(ColorUtil.fromHsl(hue, kPresetSaturation, lightness));
            }
        }
        return colors;
    }

    static loadMyPalette()
    {
        try {
            const saved = JSON.parse(localStorage.getItem(kMyPaletteStorageKey) || '[]');
            return Array.isArray(saved) ? saved.filter(Number.isInteger).slice(-kMyPaletteMax) : [];
        } catch {
            return [];
        }
    }

    saveMyPalette()
    {
        try {
            localStorage.setItem(kMyPaletteStorageKey, JSON.stringify(this.myPalette));
        } catch {
            // 保存できない環境（プライベートモードなど）でも、開いている間は使えるので続ける
        }
    }
}
