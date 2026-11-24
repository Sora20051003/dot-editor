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
// 保存するときに一度に圧縮へ流す量。全レイヤーの写しを一度に作らないよう、少しずつ写して流す
const kEncodeChunkBytes = 16 * 1024 * 1024;
// 情報（JSON）の長さの上限。壊れたファイルで巨大なメモリを取らないため
const kMaxProjectHeaderBytes = 16 * 1024 * 1024;
// 見るだけ（アバターの画面）で開ける大きさの上限。エディタの上限（iPhone は 4096）やメモリの上限とは別にする。
// 1枚ずつ縮めて使うので、絵の全部を同時には持たないため
const kMaxProjectViewSize = 16384;
const kBrokenProjectMessage = 'ファイルが壊れているか、作業ファイルではありません';
const kTruncatedProjectMessage = 'ファイルが途中で切れているか、壊れています';

// 流れてくるバイト列から、決まった長さずつ取り出す（ProjectFile.decode 用）
class ProjectByteReader
{
    constructor(stream)
    {
        this.reader = stream.getReader();
        this.chunk = new Uint8Array(0);
        this.offset = 0;
    }

    // length バイトを新しい配列で返す。途中でファイルが終わったら null
    async read(length)
    {
        const target = new Uint8Array(length);
        let filled = 0;
        while (filled < length) {
            if (this.offset >= this.chunk.length && !(await this.pullChunk())) return null;
            const count = Math.min(length - filled, this.chunk.length - this.offset);
            target.set(this.chunk.subarray(this.offset, this.offset + count), filled);
            filled += count;
            this.offset += count;
        }
        return target;
    }

    async isAtEnd()
    {
        while (this.offset >= this.chunk.length) {
            if (!(await this.pullChunk())) return true;
        }
        return false;
    }

    // 次のかたまりを取る。もうなければ false。gzip として読めないときは理由付きで例外
    async pullChunk()
    {
        let result;
        try {
            result = await this.reader.read();
        } catch {
            throw new Error(kBrokenProjectMessage);
        }
        if (result.done) return false;
        this.chunk = result.value;
        this.offset = 0;
        return true;
    }

    release()
    {
        this.reader.cancel().catch(() => {});
    }
}

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
        // 8192×8192 で 9 枚だと 2GB を超えるので、全部を1つにまとめず、少しずつ写して圧縮へ流す
        const chunks = ProjectFile.encodeChunks([prefix, json], frameSet.allLayers());
        const source = new ReadableStream({
            pull(controller)
            {
                const next = chunks.next();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
            },
        });
        return new Response(source.pipeThrough(new CompressionStream('gzip'))).blob();
    },

    // 写して渡すのは、保存の途中で絵が描き変わっても、ファイルの中身が混ざらないようにするため
    * encodeChunks(headParts, layers)
    {
        yield* headParts;
        for (const layer of layers) {
            const data = layer.canvas.imageData.data;
            for (let offset = 0; offset < data.length; offset += kEncodeChunkBytes) {
                yield data.slice(offset, offset + kEncodeChunkBytes);
            }
        }
    },

    // 戻り値は FrameSet.restore にそのまま渡せる形。読めないときは理由付きで例外を投げる。
    // options.isViewOnly：見るだけ（アバター）。エディタのメモリ・大きさの上限で弾かない
    // options.onLayer(info, frameIndex, header)：1枚読むたびに呼ぶ。渡したら中身は持ち続けない（全部を同時に持たないため）
    async decode(blob, options = {})
    {
        const isViewOnly = options.isViewOnly === true;
        // 圧縮を解きながらレイヤー1枚ずつ取り出す。全体を一度に広げると、8192 の 9 枚で 2GB を超えるため
        const reader = new ProjectByteReader(blob.stream().pipeThrough(new DecompressionStream('gzip')));
        try {
            const prefix = await reader.read(kProjectMagic.length + kJsonLengthBytes);
            if (prefix === null || ProjectFile.readMagic(prefix) !== kProjectMagic) {
                throw new Error('ドット絵エディタの作業ファイルではありません');
            }
            const jsonLength = new DataView(prefix.buffer).getUint32(kProjectMagic.length, true);
            if (jsonLength > kMaxProjectHeaderBytes) throw new Error(kBrokenProjectMessage);
            const json = await reader.read(jsonLength);
            if (json === null) throw new Error(kTruncatedProjectMessage);
            const header = ProjectFile.parseHeader(json, isViewOnly);
            const layerBytes = header.width * header.height * kRgbaBytes;
            for (const [frameIndex, frame] of header.frames.entries()) {
                for (const info of frame.layers) {
                    info.data = await reader.read(layerBytes);
                    if (info.data === null) throw new Error(kTruncatedProjectMessage);
                    if (options.onLayer === undefined) continue;
                    await options.onLayer(info, frameIndex, header);
                    info.data = null;
                }
            }
            if (!(await reader.isAtEnd())) throw new Error(kTruncatedProjectMessage);
            return header;
        } finally {
            reader.release();
        }
    },

    readMagic(bytes)
    {
        return new TextDecoder().decode(bytes.subarray(0, kProjectMagic.length));
    },

    parseHeader(jsonBytes, isViewOnly = false)
    {
        let header;
        try {
            header = JSON.parse(new TextDecoder().decode(jsonBytes));
        } catch {
            throw new Error('作業ファイルの情報が壊れています');
        }
        ProjectFile.validateHeader(header, isViewOnly ? kMaxProjectViewSize : kMaxCanvasSize);
        const rawFrames = ProjectFile.rawFramesOf(header);
        ProjectFile.validateLayerCounts(header.width, header.height, rawFrames, isViewOnly);
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

    validateLayerCounts(width, height, rawFrames, isViewOnly = false)
    {
        if (rawFrames.length < 1 || rawFrames.length > kMaxFrameCount) {
            throw new Error(`コマの数が正しくありません（1〜${kMaxFrameCount}）`);
        }
        const maxLayers = isViewOnly ? kMaxLayerCount : LayerStack.maxLayersFor(width, height);
        const isCountOk = (f) => Array.isArray(f?.layers) && f.layers.length >= 1 && f.layers.length <= maxLayers;
        if (!rawFrames.every(isCountOk)) {
            throw new Error(`レイヤーの数が正しくありません（1コマ 1〜${maxLayers} 枚）`);
        }
        if (isViewOnly) return;
        const total = rawFrames.reduce((sum, f) => sum + f.layers.length, 0);
        const limit = LayerStack.memoryLayerLimit(width, height);
        if (total > limit) {
            throw new Error(`この大きさでは全部のコマを合わせてレイヤーは ${limit} 枚までです（このファイルは ${total} 枚）`);
        }
    },

    validateHeader(header, maxSize)
    {
        if (header === null || typeof header !== 'object' || header.format !== kProjectFormat) {
            throw new Error('ドット絵エディタの作業ファイルではありません');
        }
        if (header.version !== kProjectVersion && header.version !== kProjectVersionSingleFrame) {
            throw new Error(`この版（${header.version}）の作業ファイルは開けません。新しいドット絵エディタで開いてください`);
        }
        const isSize = (v) => Number.isInteger(v) && v >= kMinCanvasSize && v <= maxSize;
        if (!isSize(header.width) || !isSize(header.height)) {
            throw new Error(`マス目の数が 1〜${maxSize} の範囲外です（${header.width}×${header.height}）`);
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
