'use strict';

// 作業ファイル（.dotart）：レイヤー分けを残したまま保存する独自形式。
// 中身は gzip で圧縮した [目印 8 バイト][JSON の長さ 4 バイト][JSON][各レイヤーの RGBA をそのまま]。
// PNG にしないのは、半透明の色が保存のたびに少しずつ変わるのを防ぐため。
// 版 2 でアニメのコマを足した（RGBA は 1コマ目のレイヤーから順に並べる）。版 1（コマなし）も開ける
const kProjectMagic = 'DOTART01';
const kProjectFormat = 'dotart';
const kProjectVersion = 2;
const kProjectVersionSingleFrame = 1;
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

    // frameSet は FrameSet
    async encode(frameSet)
    {
        frameSet.storeCurrent();
        const describeLayer = (l) => ({ name: l.name, isVisible: l.isVisible, opacity: l.opacity });
        const header = {
            format: kProjectFormat,
            version: kProjectVersion,
            width: frameSet.width,
            height: frameSet.height,
            fps: frameSet.fps,
            activeFrame: frameSet.currentIndex,
            frames: frameSet.frames.map((f) => ({ activeIndex: f.activeIndex, layers: f.layers.map(describeLayer) })),
        };
        const json = new TextEncoder().encode(JSON.stringify(header));
        const prefix = new Uint8Array(kProjectMagic.length + kJsonLengthBytes);
        prefix.set(new TextEncoder().encode(kProjectMagic));
        new DataView(prefix.buffer).setUint32(kProjectMagic.length, json.length, true);
        const parts = [prefix, json, ...frameSet.allLayers().map((l) => l.canvas.imageData.data)];
        // 8192×8192 や多くのコマを持つと数百 MB になるので、ストリームで少しずつ圧縮する
        const stream = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(stream).blob();
    },

    // 戻り値は FrameSet.restore にそのまま渡せる形。読めないときは理由付きで例外を投げる
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
        const layerCount = header.frames.reduce((sum, frame) => sum + frame.layers.length, 0);
        let offset = jsonStart + jsonLength;
        if (bytes.length !== offset + layerBytes * layerCount) {
            throw new Error('ファイルが途中で切れているか、壊れています');
        }
        for (const frame of header.frames) {
            for (const info of frame.layers) {
                info.data = bytes.subarray(offset, offset + layerBytes);
                offset += layerBytes;
            }
        }
        return header;
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
        const rawFrames = ProjectFile.rawFramesOf(header);
        ProjectFile.validateLayerCounts(header.width, header.height, rawFrames);
        return {
            width: header.width,
            height: header.height,
            fps: Number.isFinite(Number(header.fps)) ? Number(header.fps) : kDefaultFps,
            activeFrame: ProjectFile.isIndexIn(header.activeFrame, rawFrames.length) ? header.activeFrame : 0,
            frames: rawFrames.map(ProjectFile.normalizeFrame),
        };
    },

    // 版 1 はコマが無いので、1コマのアニメとして読む
    rawFramesOf(header)
    {
        if (header.version === kProjectVersionSingleFrame) {
            return [{ activeIndex: header.activeIndex, layers: header.layers }];
        }
        return Array.isArray(header.frames) ? header.frames : [];
    },

    normalizeFrame(frame)
    {
        const layers = frame.layers.map(ProjectFile.normalizeLayerInfo);
        const activeIndex = ProjectFile.isIndexIn(frame.activeIndex, layers.length) ? frame.activeIndex : 0;
        return { activeIndex, layers };
    },

    validateLayerCounts(width, height, rawFrames)
    {
        if (rawFrames.length < 1 || rawFrames.length > kMaxFrameCount) {
            throw new Error(`コマの数が正しくありません（1〜${kMaxFrameCount}）`);
        }
        const maxLayers = LayerStack.maxLayersFor(width, height);
        const isCountOk = (f) => Array.isArray(f?.layers) && f.layers.length >= 1 && f.layers.length <= maxLayers;
        if (!rawFrames.every(isCountOk)) {
            throw new Error(`レイヤーの数が正しくありません（1コマ 1〜${maxLayers} 枚）`);
        }
        const total = rawFrames.reduce((sum, f) => sum + f.layers.length, 0);
        const limit = LayerStack.memoryLayerLimit(width, height);
        if (total > limit) {
            throw new Error(`この大きさでは全部のコマを合わせてレイヤーは ${limit} 枚までです（このファイルは ${total} 枚）`);
        }
    },

    validateHeader(header)
    {
        if (header === null || typeof header !== 'object' || header.format !== kProjectFormat) {
            throw new Error('ドット絵エディタの作業ファイルではありません');
        }
        if (header.version !== kProjectVersion && header.version !== kProjectVersionSingleFrame) {
            throw new Error(`この版（${header.version}）の作業ファイルは開けません。新しいドット絵エディタで開いてください`);
        }
        const isSize = (v) => Number.isInteger(v) && v >= kMinCanvasSize && v <= kMaxCanvasSize;
        if (!isSize(header.width) || !isSize(header.height)) {
            throw new Error(`マス目の数が 1〜${kMaxCanvasSize} の範囲外です（${header.width}×${header.height}）`);
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
