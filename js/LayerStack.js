'use strict';

const kBaseLayerName = '下地';
const kMaxLayerCount = 32;
// レイヤー全部の絵に使ってよいメモリ。4096×4096 は1枚 64MB なので約 12 枚
const kLayerMemoryBudget = 768 * 1024 * 1024;
const kBytesPerPixel = 4;

class Layer
{
    constructor(id, name, width, height)
    {
        this.id = id;
        this.name = name;
        this.canvas = new PixelCanvas(width, height);
        this.isVisible = true;
        this.opacity = 1;
    }
}

// レイヤーの重なり。layers[0] がいちばん下（下地）
class LayerStack
{
    constructor(width, height)
    {
        this.nextId = 1;
        this.nextNumber = 1;
        this.resetDefault(width, height);
    }

    get width()
    {
        return this.layers[0].canvas.width;
    }

    get height()
    {
        return this.layers[0].canvas.height;
    }

    get active()
    {
        return this.layers[this.activeIndex];
    }

    get activeCanvas()
    {
        return this.active.canvas;
    }

    get maxLayers()
    {
        return LayerStack.maxLayersFor(this.width, this.height);
    }

    static maxLayersFor(width, height)
    {
        const bytesPerLayer = width * height * kBytesPerPixel;
        return Math.max(1, Math.min(kMaxLayerCount, Math.floor(kLayerMemoryBudget / bytesPerLayer)));
    }

    get canAdd()
    {
        return this.layers.length < this.maxLayers;
    }

    get canRemove()
    {
        return this.layers.length > 1;
    }

    createLayer(name, width, height)
    {
        return new Layer(this.nextId++, name, width, height);
    }

    takeNewLayerName()
    {
        return `レイヤー ${this.nextNumber++}`;
    }

    // 新しく描き始めるときの形：下地と、その上に描くレイヤー 1
    resetDefault(width, height)
    {
        this.nextNumber = 1;
        const base = this.createLayer(kBaseLayerName, width, height);
        const upper = this.createLayer(this.takeNewLayerName(), width, height);
        this.layers = [base, upper];
        this.activeIndex = 1;
    }

    resetWithImage(imageData)
    {
        this.nextNumber = 1;
        const base = this.createLayer(kBaseLayerName, imageData.width, imageData.height);
        base.canvas.loadImageData(imageData);
        this.layers = [base];
        this.activeIndex = 0;
    }

    // 作業ファイル（ProjectFile.decode の結果）から全レイヤーを作り直す
    restore(project)
    {
        const { width, height } = project;
        this.layers = project.layers.map((info) => {
            const layer = this.createLayer(info.name, width, height);
            layer.canvas.imageData.data.set(info.data);
            layer.canvas.markAllDirty();
            layer.isVisible = info.isVisible;
            layer.opacity = info.opacity;
            return layer;
        });
        this.activeIndex = project.activeIndex;
        this.nextNumber = this.layers.length;
    }

    // 大きくするとメモリが足りなくなる枚数のときは呼ぶ側で止める（maxLayersFor で確かめる）
    resize(width, height)
    {
        for (const layer of this.layers) layer.canvas.resize(width, height);
    }

    setActive(index)
    {
        if (index < 0 || index >= this.layers.length) return;
        this.activeIndex = index;
    }

    // 選んでいるレイヤーのすぐ上に足して、それを選ぶ
    addLayer()
    {
        if (!this.canAdd) return false;
        const layer = this.createLayer(this.takeNewLayerName(), this.width, this.height);
        this.insertAboveActive(layer);
        return true;
    }

    duplicateActive()
    {
        if (!this.canAdd) return false;
        const source = this.active;
        const copy = this.createLayer(`${source.name} のコピー`, this.width, this.height);
        copy.canvas.pixels.set(source.canvas.pixels);
        copy.canvas.markAllDirty();
        copy.isVisible = source.isVisible;
        copy.opacity = source.opacity;
        this.insertAboveActive(copy);
        return true;
    }

    insertAboveActive(layer)
    {
        this.layers.splice(this.activeIndex + 1, 0, layer);
        this.activeIndex++;
    }

    // 消したレイヤーを返す（取り消し履歴から外すため）。最後の1枚は消さない
    removeActive()
    {
        if (!this.canRemove) return null;
        const [removed] = this.layers.splice(this.activeIndex, 1);
        this.activeIndex = Math.min(this.activeIndex, this.layers.length - 1);
        return removed;
    }

    // direction は +1 で上へ、-1 で下へ
    moveActive(direction)
    {
        const target = this.activeIndex + direction;
        if (target < 0 || target >= this.layers.length) return false;
        const layers = this.layers;
        [layers[this.activeIndex], layers[target]] = [layers[target], layers[this.activeIndex]];
        this.activeIndex = target;
        return true;
    }

    isInside(x, y)
    {
        return this.layers[0].canvas.isInside(x, y);
    }

    // 画面で見えている色。上の見えているレイヤーから順に、透明でない色を探す
    pickVisibleColor(x, y)
    {
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            if (!layer.isVisible || layer.opacity === 0) continue;
            const color = layer.canvas.getPixel(x, y);
            if (ColorUtil.unpack(color).a > 0) return color;
        }
        return ColorUtil.kTransparent;
    }

    visibleLayers()
    {
        return this.layers.filter((layer) => layer.isVisible && layer.opacity > 0);
    }
}
