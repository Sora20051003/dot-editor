'use strict';

const kGrowableInitialCapacity = 1024;
const kBytesPerRecordedPixel = 12;  // 位置・前の色・後の色を 4 バイトずつ

// 長さが事前に分からない記録用。普通の配列より大きなサイズで軽い
class GrowableUint32
{
    constructor()
    {
        this.data = new Uint32Array(kGrowableInitialCapacity);
        this.length = 0;
    }

    push(value)
    {
        if (this.length === this.data.length) {
            const next = new Uint32Array(this.data.length * 2);
            next.set(this.data);
            this.data = next;
        }
        this.data[this.length++] = value;
    }

    get(index)
    {
        return this.data[index];
    }

    toArray()
    {
        return this.data.slice(0, this.length);
    }
}

// 取り消し・やり直し。4096×4096 でも扱えるよう、絵全体の写しではなく
// 「変わったマスと前後の色」だけを1操作ぶん記録する。
// 1回の操作は1枚のレイヤー（PixelCanvas）だけを変える前提で、どのレイヤーかも一緒に持つ。
class EditHistory
{
    constructor(maxBytes)
    {
        this.maxBytes = maxBytes;
        this.touched = null;
        this.clear();
    }

    clear()
    {
        this.undoStack = [];
        this.redoStack = [];
        this.totalBytes = 0;
        this.current = null;
    }

    get canUndo()
    {
        return this.undoStack.length > 0;
    }

    get canRedo()
    {
        return this.redoStack.length > 0;
    }

    begin(pixelCanvas)
    {
        const pixelCount = pixelCanvas.width * pixelCanvas.height;
        // 同じマスを何度なぞっても最初の色だけ残すための目印
        if (this.touched === null || this.touched.length !== pixelCount) {
            this.touched = new Uint8Array(pixelCount);
        }
        this.current = EditHistory.createRecording(pixelCanvas);
    }

    static createRecording(pixelCanvas)
    {
        return { canvas: pixelCanvas, indices: new GrowableUint32(), oldColors: new GrowableUint32() };
    }

    record(index, oldColor)
    {
        if (this.current === null || this.touched[index] === 1) return;
        this.touched[index] = 1;
        this.current.indices.push(index);
        this.current.oldColors.push(oldColor);
    }

    // 線や四角の下書きを消して描き直すときに使う
    revertCurrent()
    {
        const current = this.current;
        if (current === null) return;
        for (let i = 0; i < current.indices.length; i++) {
            const index = current.indices.get(i);
            current.canvas.setPixelAt(index, current.oldColors.get(i));
            this.touched[index] = 0;
        }
        this.current = EditHistory.createRecording(current.canvas);
    }

    // 1操作を確定する。何も変わっていなければ記録せず false
    commit()
    {
        const current = this.current;
        this.current = null;
        if (current === null || current.indices.length === 0) return false;

        const entry = this.buildEntry(current);
        for (const index of entry.indices) this.touched[index] = 0;
        if (this.isAllUnchanged(entry)) return false;

        this.undoStack.push(entry);
        this.totalBytes += entry.byteSize;
        this.clearRedo();
        this.trimToBudget();
        return true;
    }

    buildEntry(current)
    {
        const canvas = current.canvas;
        const indices = current.indices.toArray();
        const oldColors = current.oldColors.toArray();
        const newColors = new Uint32Array(indices.length);
        for (let i = 0; i < indices.length; i++) newColors[i] = canvas.pixels[indices[i]];
        const bounds = this.computeBounds(indices, canvas.width);
        const byteSize = indices.length * kBytesPerRecordedPixel;
        return { canvas, indices, oldColors, newColors, bounds, byteSize };
    }

    // 下書きで塗って戻しただけのマスも記録されるので、本当に変わったかを見る
    isAllUnchanged(entry)
    {
        for (let i = 0; i < entry.indices.length; i++) {
            if (entry.oldColors[i] !== entry.newColors[i]) return false;
        }
        return true;
    }

    computeBounds(indices, width)
    {
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const index of indices) {
            const x = index % width;
            const y = Math.floor(index / width);
            bounds.minX = Math.min(bounds.minX, x);
            bounds.minY = Math.min(bounds.minY, y);
            bounds.maxX = Math.max(bounds.maxX, x);
            bounds.maxY = Math.max(bounds.maxY, y);
        }
        return bounds;
    }

    clearRedo()
    {
        for (const entry of this.redoStack) this.totalBytes -= entry.byteSize;
        this.redoStack = [];
    }

    // メモリを使いすぎないよう古い操作から捨てる。直前の1操作は必ず残す
    trimToBudget()
    {
        while (this.totalBytes > this.maxBytes && this.undoStack.length > 1) {
            this.totalBytes -= this.undoStack.shift().byteSize;
        }
    }

    // レイヤーを消したとき、そのレイヤーへの操作を履歴から外す
    removeCanvas(pixelCanvas)
    {
        const isKept = (entry) => entry.canvas !== pixelCanvas;
        this.undoStack = this.undoStack.filter(isKept);
        this.redoStack = this.redoStack.filter(isKept);
        this.totalBytes = [...this.undoStack, ...this.redoStack].reduce((sum, e) => sum + e.byteSize, 0);
    }

    undo()
    {
        return this.moveEntry(this.undoStack, this.redoStack, 'oldColors');
    }

    redo()
    {
        return this.moveEntry(this.redoStack, this.undoStack, 'newColors');
    }

    moveEntry(fromStack, toStack, colorKey)
    {
        if (this.current !== null || fromStack.length === 0) return false;
        const entry = fromStack.pop();
        const colors = entry[colorKey];
        const pixels = entry.canvas.pixels;
        for (let i = 0; i < entry.indices.length; i++) pixels[entry.indices[i]] = colors[i];
        entry.canvas.markDirtyRect(entry.bounds);
        toStack.push(entry);
        return true;
    }
}
