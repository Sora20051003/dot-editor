'use strict';

// 色は Uint32Array にそのまま入れられる 32bit 値で持つ。
// ブラウザはリトルエンディアンなので、下位バイトから R, G, B, A の順になる。
const ColorUtil = (() => {
    const kChannelMax = 255;
    const kByteMask = 0xff;
    const kHexRadix = 16;
    const kDegreesPerSector = 60;
    const kSectorCount = 6;
    const kTransparent = 0;

    function pack(r, g, b, a) {
        return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }

    function unpack(color) {
        return {
            r: color & kByteMask,
            g: (color >>> 8) & kByteMask,
            b: (color >>> 16) & kByteMask,
            a: color >>> 24,
        };
    }

    function toHexByte(value) {
        return value.toString(kHexRadix).padStart(2, '0').toUpperCase();
    }

    // 不透明なら #RRGGBB、半透明なら #RRGGBBAA
    function toHex(color) {
        const c = unpack(color);
        const rgb = `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}`;
        return c.a === kChannelMax ? rgb : rgb + toHexByte(c.a);
    }

    // <input type="color"> は透明度を持てないので RGB だけ渡す
    function toRgbHex(color) {
        const c = unpack(color);
        return `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}`.toLowerCase();
    }

    function toCss(color) {
        const c = unpack(color);
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / kChannelMax})`;
    }

    function isChannel(value) {
        return Number.isInteger(value) && value >= 0 && value <= kChannelMax;
    }

    function expandShortHex(body) {
        if (body.length === 3 || body.length === 4) {
            return body
                .split('')
                .map((ch) => ch + ch)
                .join('');
        }
        if (body.length === 6 || body.length === 8) return body;
        return null;
    }

    function parseHex(text) {
        const body = text.replace(/^(#|0x)/, '');
        if (!/^[0-9a-f]+$/.test(body)) return null;
        const hex = expandShortHex(body);
        if (hex === null) return null;
        const readByte = (start) => parseInt(hex.slice(start, start + 2), kHexRadix);
        const alpha = hex.length === 8 ? readByte(6) : kChannelMax;
        return pack(readByte(0), readByte(2), readByte(4), alpha);
    }

    // CSS の rgba() と同じく、小数で書かれた透明度は 0〜1 として読む
    function parseAlpha(text, value) {
        if (text.includes('.') && value >= 0 && value <= 1) {
            return Math.round(value * kChannelMax);
        }
        return isChannel(value) ? value : null;
    }

    // 「255, 128, 0」「rgb(255 128 0)」「rgba(255,128,0,0.5)」を受け付ける
    function parseNumberList(text) {
        const body = text.replace(/^rgba?\(/, '').replace(/\)$/, '');
        const parts = body.split(/[\s,/]+/).filter((part) => part !== '');
        if (parts.length !== 3 && parts.length !== 4) return null;
        const values = parts.map(Number);
        const [r, g, b] = values;
        if (![r, g, b].every(isChannel)) return null;
        const alpha = parts.length === 4 ? parseAlpha(parts[3], values[3]) : kChannelMax;
        if (alpha === null) return null;
        return pack(r, g, b, alpha);
    }

    function parseCode(text) {
        const normalized = text.trim().toLowerCase();
        if (normalized === '') return null;
        const hexColor = parseHex(normalized);
        return hexColor !== null ? hexColor : parseNumberList(normalized);
    }

    // saturation, lightness は 0〜1
    function fromHsl(hueDegrees, saturation, lightness) {
        const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
        const huePrime = hueDegrees / kDegreesPerSector;
        const second = chroma * (1 - Math.abs((huePrime % 2) - 1));
        const sectors = [
            [chroma, second, 0],
            [second, chroma, 0],
            [0, chroma, second],
            [0, second, chroma],
            [second, 0, chroma],
            [chroma, 0, second],
        ];
        const [r, g, b] = sectors[Math.floor(huePrime) % kSectorCount];
        const offset = lightness - chroma / 2;
        const toByte = (v) => Math.round((v + offset) * kChannelMax);
        return pack(toByte(r), toByte(g), toByte(b), kChannelMax);
    }

    // 色の四角（ColorPicker）用。saturation, value は 0〜1、alpha は 0〜255
    function fromHsv(hueDegrees, saturation, value, alpha = kChannelMax) {
        const chroma = value * saturation;
        const fullCircle = kDegreesPerSector * kSectorCount;
        const huePrime = (((hueDegrees % fullCircle) + fullCircle) % fullCircle) / kDegreesPerSector;
        const second = chroma * (1 - Math.abs((huePrime % 2) - 1));
        const sectors = [
            [chroma, second, 0],
            [second, chroma, 0],
            [0, chroma, second],
            [0, second, chroma],
            [second, 0, chroma],
            [chroma, 0, second],
        ];
        const [r, g, b] = sectors[Math.floor(huePrime) % kSectorCount];
        const offset = value - chroma;
        const toByte = (v) => Math.round((v + offset) * kChannelMax);
        return pack(toByte(r), toByte(g), toByte(b), alpha);
    }

    // 灰色（鮮やかさ 0）のときの色相は決まらないので 0 を返す。呼ぶ側で前の色相を残す
    function toHsv(color) {
        const c = unpack(color);
        const r = c.r / kChannelMax;
        const g = c.g / kChannelMax;
        const b = c.b / kChannelMax;
        const max = Math.max(r, g, b);
        const chroma = max - Math.min(r, g, b);
        let huePrime = 0;
        if (chroma > 0 && max === r) huePrime = ((g - b) / chroma + kSectorCount) % kSectorCount;
        else if (chroma > 0 && max === g) huePrime = (b - r) / chroma + 2;
        else if (chroma > 0) huePrime = (r - g) / chroma + 4;
        return { h: huePrime * kDegreesPerSector, s: max === 0 ? 0 : chroma / max, v: max };
    }

    return {
        kChannelMax,
        kTransparent,
        pack,
        unpack,
        toHex,
        toRgbHex,
        toCss,
        parseCode,
        fromHsl,
        fromHsv,
        toHsv,
    };
})();
