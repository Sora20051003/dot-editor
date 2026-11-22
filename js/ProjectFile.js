'use strict';

// 作業ファイル（.dotart）：レイヤー分けを残したまま保存する独自形式。
// 中身は gzip で圧縮した [目印 8 バイト][JSON の長さ 4 バイト][JSON][各レイヤーの RGBA をそのまま]。
// PNG にしないのは、半透明の色が保存のたびに少しずつ変わるのを防ぐため。
const kProjectMagic = 'DOTART01';
const kProjectFormat = 'dotart';
const kProjectVersion = 1;
const kProjectExtension = '.dotart';
const kJsonLengthBytes = 4;
const kRgbaBytes = 4;

const ProjectFile = {
    isProjectFileName(name)
    {
        return name.toLowerCase().endsWith(kProjectExtension);
    },

    toProjectFileName(baseName)
    {
        return baseName + kProjectExtension;
    },

    async encode(layers)
    {
        const header = {
            format: kProjectFormat,
            version: kProjectVersion,
            width: layers.width,
            height: layers.height,
            activeIndex: layers.activeIndex,
            layers: layers.layers.map((l) => ({ name: l.name, isVisible: l.isVisible, opacity: l.opacity })),
        };
        const json = new TextEncoder().encode(JSON.stringify(header));
        const prefix = new Uint8Array(kProjectMagic.length + kJsonLengthBytes);
        prefix.set(new TextEncoder().encode(kProjectMagic));
        new DataView(prefix.buffer).setUint32(kProjectMagic.length, json.length, true);
        const parts = [prefix, json, ...layers.layers.map((l) => l.canvas.imageData.data)];
        // 4096×4096 を何枚も持つと数百 MB になるので、ストリームで少しずつ圧縮する
        const stream = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(stream).blob();
    },

    // 戻り値は LayerStack.restore にそのまま渡せる形。読めないときは理由付きで例外を投げる
    async decode(blob)
    {
        const bytes = await ProjectFile.decompress(blob);
        const jsonStart = kProjectMagic.length + kJsonLengthBytes;
        if (bytes.length < jsonStart || ProjectFile.readMagic(bytes) !== kProjectMagic) {
            throw new Error('ドット絵エディタの作業ファイルではありません');
        }
        const jsonLength = new DataView(bytes.buffer).getUint32(kProjectMagic.length, true);
        const header = ProjectFile.parseHeader(bytes.subarray(jsonStart, jsonStart + jsonLength));
        const layerBytes = header.width * header.height * kRgbaBytes;
        const pixelStart = jsonStart + jsonLength;
        if (bytes.length !== pixelStart + layerBytes * header.layers.length) {
            throw new Error('ファイルが途中で切れているか、壊れています');
        }
        const layers = header.layers.map((info, i) => ({
            ...info,
            data: bytes.subarray(pixelStart + layerBytes * i, pixelStart + layerBytes * (i + 1)),
        }));
        return { width: header.width, height: header.height, activeIndex: header.activeIndex, layers };
    },

    async decompress(blob)
    {
        try {
            const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch {
            throw new Error('ファイルが壊れているか、作業ファイルではありません');
        }
    },

    readMagic(bytes)
    {
        return new TextDecoder().decode(bytes.subarray(0, kProjectMagic.length));
    },

    parseHeader(jsonBytes)
    {
        let header;
        try {
            header = JSON.parse(new TextDecoder().decode(jsonBytes));
        } catch {
            throw new Error('作業ファイルの情報が壊れています');
        }
        ProjectFile.validateHeader(header);
        return {
            width: header.width,
            height: header.height,
            activeIndex: ProjectFile.isIndexIn(header.activeIndex, header.layers.length) ? header.activeIndex : 0,
            layers: header.layers.map(ProjectFile.normalizeLayerInfo),
        };
    },

    validateHeader(header)
    {
        if (header === null || typeof header !== 'object' || header.format !== kProjectFormat) {
            throw new Error('ドット絵エディタの作業ファイルではありません');
        }
        if (header.version !== kProjectVersion) {
            throw new Error(`この版（${header.version}）の作業ファイルは開けません`);
        }
        const isSize = (v) => Number.isInteger(v) && v >= kMinCanvasSize && v <= kMaxCanvasSize;
        if (!isSize(header.width) || !isSize(header.height)) {
            throw new Error('マス目の数が 1〜4096 の範囲外です');
        }
        const maxLayers = LayerStack.maxLayersFor(header.width, header.height);
        const count = Array.isArray(header.layers) ? header.layers.length : 0;
        if (count < 1 || count > maxLayers) {
            throw new Error(`レイヤーの数が正しくありません（1〜${maxLayers} 枚）`);
        }
    },

    // 名前や不透明度がおかしくても、絵そのものは開けるように直して読む
    normalizeLayerInfo(info, index)
    {
        const name = typeof info?.name === 'string' && info.name.trim() !== '' ? info.name : `レイヤー ${index + 1}`;
        const opacity = Number(info?.opacity);
        return {
            name: name.slice(0, kMaxLayerNameLength),
            isVisible: info?.isVisible !== false,
            opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
        };
    },

    isIndexIn(value, length)
    {
        return Number.isInteger(value) && value >= 0 && value < length;
    },
};

// 作業ファイルの保存先。Chrome / Edge では保存場所を一度選べば、次からは同じファイルに上書きする。
// その機能が無いブラウザでは、毎回ダウンロードフォルダに保存する
class ProjectSaveTarget
{
    constructor()
    {
        this.handle = null;
    }

    static get canPick()
    {
        return typeof window.showSaveFilePicker === 'function';
    }

    setHandle(handle)
    {
        this.handle = handle;
    }

    clear()
    {
        this.handle = null;
    }

    // 保存したファイル名を返す。保存場所の選択をやめたときは AbortError が投げられる
    async save(blob, suggestedName)
    {
        if (!ProjectSaveTarget.canPick) {
            ImageFile.download(blob, suggestedName);
            return suggestedName;
        }
        if (this.handle === null) {
            this.handle = await window.showSaveFilePicker({
                suggestedName,
                types: [{ description: 'ドット絵の作業ファイル', accept: { 'application/octet-stream': [kProjectExtension] } }],
            });
        }
        const writable = await this.handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return this.handle.name;
    }
}
