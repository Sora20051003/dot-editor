'use strict';

const kMaxFrameCount = 500;
const kDefaultFps = 8;
const kMinFps = 1;
const kMaxFps = 30;

// アニメのコマの並び。各コマはレイヤーの一式（Layer の配列）と、選んでいるレイヤーの番号を持つ。
// 描く・レイヤー欄などの部品は LayerStack だけを見ているので、コマを替えるときは
// LayerStack の中身（layers と activeIndex）を差し替える。こうすると今ある部品はそのまま動く
class FrameSet
{
    constructor(stack)
    {
        this.stack = stack;
        this.fps = kDefaultFps;
        this.resetToCurrent();
        stack.countOutsideLayers = () => this.totalLayerCount() - this.stack.layers.length;
    }

    get count()
    {
        return this.frames.length;
    }

    get width()
    {
        return this.stack.width;
    }

    get height()
    {
        return this.stack.height;
    }

    // LayerStack が今表示している内容を1コマだけにする（新しく描く・画像を開いたあと）
    resetToCurrent()
    {
        this.frames = [{ layers: this.stack.layers, activeIndex: this.stack.activeIndex }];
        this.currentIndex = 0;
    }

    // 今のコマの状態（レイヤーを足した・選んだなど）を覚え直す。
    // LayerStack は layers を作り直すことがあるので、触る前に毎回これを呼ぶ
    storeCurrent()
    {
        const frame = this.frames[this.currentIndex];
        frame.layers = this.stack.layers;
        frame.activeIndex = this.stack.activeIndex;
    }

    select(index)
    {
        if (index < 0 || index >= this.frames.length) return false;
        this.storeCurrent();
        this.currentIndex = index;
        const frame = this.frames[index];
        this.stack.load(frame.layers, frame.activeIndex);
        return true;
    }

    // 再生用。最後のコマの次は最初に戻る
    selectNext(step = 1)
    {
        const next = (this.currentIndex + step) % this.frames.length;
        return this.select(next);
    }

    totalLayerCount()
    {
        let total = 0;
        for (let i = 0; i < this.frames.length; i++) total += this.layersOf(i).length;
        return total;
    }

    // 今のコマは LayerStack のほうが新しいので、そちらを返す
    layersOf(index)
    {
        return index === this.currentIndex ? this.stack.layers : this.frames[index].layers;
    }

    allLayers()
    {
        const all = [];
        for (let i = 0; i < this.frames.length; i++) all.push(...this.layersOf(i));
        return all;
    }

    // 画像の書き出し（ImageFile.composeLayers）にそのまま渡せる形
    frameImageSource(index)
    {
        const layers = this.layersOf(index);
        return { width: this.width, height: this.height, visibleLayers: () => LayerStack.visibleOf(layers) };
    }

    indexOfCanvas(pixelCanvas)
    {
        return this.frames.findIndex((_, i) => this.layersOf(i).some((l) => l.canvas === pixelCanvas));
    }

    canAddLayers(layerCount)
    {
        if (this.frames.length >= kMaxFrameCount) return false;
        const limit = LayerStack.memoryLayerLimit(this.width, this.height);
        return this.totalLayerCount() + layerCount <= limit;
    }

    get addLimitMessage()
    {
        if (this.frames.length >= kMaxFrameCount) return `コマは ${kMaxFrameCount} まで作れます`;
        const limit = LayerStack.memoryLayerLimit(this.width, this.height);
        return `この大きさでは、全部のコマを合わせてレイヤーは ${limit} 枚までです。レイヤーかコマを減らしてください`;
    }

    // 今のコマのすぐ後ろに、同じ形の空のコマを足してそれを選ぶ
    addFrame()
    {
        this.storeCurrent();
        if (!this.canAddLayers(this.stack.layers.length)) return false;
        this.insertAfterCurrent(this.stack.buildBlankLike(this.stack.layers));
        return true;
    }

    duplicateFrame()
    {
        this.storeCurrent();
        if (!this.canAddLayers(this.stack.layers.length)) return false;
        this.insertAfterCurrent(this.stack.buildCopies(this.stack.layers));
        return true;
    }

    insertAfterCurrent(layers)
    {
        this.frames.splice(this.currentIndex + 1, 0, { layers, activeIndex: this.stack.activeIndex });
        this.select(this.currentIndex + 1);
    }

    // 消したコマのレイヤーを返す（取り消し履歴から外すため）。最後の1コマは消さない
    removeFrame()
    {
        if (this.frames.length <= 1) return null;
        this.storeCurrent();
        const [removed] = this.frames.splice(this.currentIndex, 1);
        this.currentIndex = Math.min(this.currentIndex, this.frames.length - 1);
        const frame = this.frames[this.currentIndex];
        this.stack.load(frame.layers, frame.activeIndex);
        return removed.layers;
    }

    // direction は +1 で後ろへ、-1 で前へ
    moveFrame(direction)
    {
        const target = this.currentIndex + direction;
        if (target < 0 || target >= this.frames.length) return false;
        this.storeCurrent();
        const frames = this.frames;
        [frames[this.currentIndex], frames[target]] = [frames[target], frames[this.currentIndex]];
        this.currentIndex = target;
        return true;
    }

    // 大きさを変えたときにメモリが足りるか（足りないなら理由、足りるなら null）
    checkResize(width, height)
    {
        this.storeCurrent();
        const perFrame = LayerStack.maxLayersFor(width, height);
        if (this.frames.some((frame) => frame.layers.length > perFrame)) {
            return `${width}×${height} では1コマのレイヤーは ${perFrame} 枚までです。先に減らしてください`;
        }
        const limit = LayerStack.memoryLayerLimit(width, height);
        if (this.totalLayerCount() > limit) {
            return `${width}×${height} では全部のコマを合わせてレイヤーは ${limit} 枚までです。先にコマかレイヤーを減らしてください`;
        }
        return null;
    }

    // 全部のコマの大きさを変える。先に checkResize で確かめておく
    resize(width, height)
    {
        this.storeCurrent();
        for (const frame of this.frames) {
            for (const layer of frame.layers) layer.canvas.resize(width, height);
        }
    }

    setFps(value)
    {
        const rounded = Math.round(Number(value)) || kDefaultFps;
        this.fps = Math.min(kMaxFps, Math.max(kMinFps, rounded));
    }

    // 作業ファイル（ProjectFile.decode の結果）から全コマを作り直す
    restore(project)
    {
        const { width, height } = project;
        this.frames = project.frames.map((frame) => ({
            layers: this.stack.buildLayers(width, height, frame.layers),
            activeIndex: frame.activeIndex,
        }));
        this.stack.nextNumber = Math.max(...this.frames.map((f) => f.layers.length));
        this.currentIndex = project.activeFrame;
        const current = this.frames[this.currentIndex];
        this.stack.load(current.layers, current.activeIndex);
        this.setFps(project.fps);
    }
}
