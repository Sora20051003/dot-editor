'use strict';

const kBaseLayerName = '下地';
const kMaxLayerCount = 32;
// レイヤー全部の絵に使ってよいメモリ（アニメの全コマの合計）。
// メモリが多い PC（8GB 以上）は 2560MB：8192×8192（1枚 256MB）で 10 枚＝アバターの部品（前髪の影を含む）が全部入る。
// 少ない PC や量が分からないときは 768MB（8192 で 3 枚・4096 で 12 枚）にして、タブが落ちるのを防ぐ。
// navigator.deviceMemory は Chrome / Edge だけが持ち、8 より大きい値は 8 と答える
const kLargeMemoryDeviceGb = 8;
const kLayerMemoryBudgetLarge = 2560 * 1024 * 1024;
const kLayerMemoryBudgetSmall = 768 * 1024 * 1024;
const kLayerMemoryBudget = (navigator.deviceMemory ?? 0) >= kLargeMemoryDeviceGb
    ? kLayerMemoryBudgetLarge
    : kLayerMemoryBudgetSmall;
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
        // 今のコマ以外（アニメのほかのコマ）にあるレイヤーの枚数。メモリの上限は全コマの合計で数えるため。
        // アニメを使わないとき（通信モードの絵など）は 0 のまま
        this.countOutsideLayers = () => 0;
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

    // 1コマに重ねられる枚数
    static maxLayersFor(width, height)
    {
        return Math.min(kMaxLayerCount, LayerStack.memoryLayerLimit(width, height));
    }

    // メモリの上限から決まる、全コマ合計の枚数
    static memoryLayerLimit(width, height)
    {
        const bytesPerLayer = width * height * kBytesPerPixel;
        return Math.max(1, Math.floor(kLayerMemoryBudget / bytesPerLayer));
    }

    get canAdd()
    {
        const total = this.layers.length + this.countOutsideLayers();
        return this.layers.length < this.maxLayers && total < LayerStack.memoryLayerLimit(this.width, this.height);
    }

    // レイヤーを足せないときの説明
    get addLimitMessage()
    {
        if (this.layers.length >= this.maxLayers) return `この大きさではレイヤーは ${this.maxLayers} 枚までです`;
        const limit = LayerStack.memoryLayerLimit(this.width, this.height);
        return `この大きさでは、全部のコマを合わせてレイヤーは ${limit} 枚までです`;
    }

    static visibleOf(layers)
    {
        return layers.filter((layer) => layer.isVisible && layer.opacity > 0);
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

    // 作業ファイルの1コマ分（ProjectFile.decode の frames の1つ）からレイヤーを作る。
    // 並びへの組み込みは呼ぶ側（FrameSet）がする
    buildLayers(width, height, layerInfos)
    {
        return layerInfos.map((info) => {
            const layer = this.createLayer(info.name, width, height);
            layer.canvas.imageData.data.set(info.data);
            // 写し終えた読み込み分はすぐ手放す（8192 の 9 枚だと、残すと倍のメモリになるため）
            info.data = null;
            layer.canvas.markAllDirty();
            layer.isVisible = info.isVisible;
            layer.opacity = info.opacity;
            return layer;
        });
    }

    // 中身が空の同じ形（名前・表示・不透明度）のレイヤーを作る。アニメのコマを足すとき用
    buildBlankLike(sourceLayers)
    {
        return sourceLayers.map((source) => {
            const layer = this.createLayer(source.name, this.width, this.height);
            layer.isVisible = source.isVisible;
            layer.opacity = source.opacity;
            return layer;
        });
    }

    // 絵ごと写したレイヤーを作る。アニメのコマを複製するとき用
    buildCopies(sourceLayers)
    {
        return sourceLayers.map((source) => {
            const layer = this.buildBlankLike([source])[0];
            layer.canvas.pixels.set(source.canvas.pixels);
            layer.canvas.markAllDirty();
            return layer;
        });
    }

    // 表示するレイヤーの並びを差し替える（アニメでコマを替えるとき）
    load(layers, activeIndex)
    {
        this.layers = layers;
        this.activeIndex = Math.min(Math.max(0, activeIndex), layers.length - 1);
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
        return LayerStack.visibleOf(this.layers);
    }
}
