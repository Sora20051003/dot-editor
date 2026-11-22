'use strict';

const kPercent = 100;
const kMaxLayerNameLength = 40;

// レイヤー欄。選ぶ・追加・複製・並べ替え・表示切り替え・不透明度・名前の変更を受け持つ。
// 削除だけは取り消し履歴の後始末が要るので App に任せる
class LayerPanel
{
    // handlers: onChange(), onRemoveRequest(), onMessage(text)
    constructor(layers, handlers)
    {
        this.layers = layers;
        this.handlers = handlers;
        const byId = (id) => document.getElementById(id);
        this.el = {
            list: byId('layerList'),
            add: byId('btnLayerAdd'),
            duplicate: byId('btnLayerDup'),
            remove: byId('btnLayerDelete'),
            up: byId('btnLayerUp'),
            down: byId('btnLayerDown'),
            opacity: byId('layerOpacity'),
            opacityLabel: byId('layerOpacityLabel'),
        };
        this.bindEvents();
        this.render();
    }

    bindEvents()
    {
        const el = this.el;
        el.add.addEventListener('click', () => this.runAndRefresh(() => this.layers.addLayer()));
        el.duplicate.addEventListener('click', () => this.runAndRefresh(() => this.layers.duplicateActive()));
        el.remove.addEventListener('click', () => this.handlers.onRemoveRequest());
        el.up.addEventListener('click', () => this.runAndRefresh(() => this.layers.moveActive(1)));
        el.down.addEventListener('click', () => this.runAndRefresh(() => this.layers.moveActive(-1)));
        el.opacity.addEventListener('input', () => this.applyOpacity());
    }

    runAndRefresh(action)
    {
        if (!action()) {
            if (!this.layers.canAdd) {
                this.handlers.onMessage(`この大きさではレイヤーは ${this.layers.maxLayers} 枚までです`);
            }
            return;
        }
        this.render();
        this.handlers.onChange();
    }

    applyOpacity()
    {
        this.layers.active.opacity = Number(this.el.opacity.value) / kPercent;
        this.el.opacityLabel.textContent = `${this.el.opacity.value}%`;
        this.handlers.onChange();
    }

    // 画面では上にあるレイヤーほど上に並べる（重なりの順と同じ見た目にする）
    render()
    {
        const rows = this.layers.layers.map((layer, index) => this.createRow(layer, index)).reverse();
        this.el.list.replaceChildren(...rows);
        this.refreshControls();
    }

    refreshControls()
    {
        const layers = this.layers;
        const el = this.el;
        el.add.disabled = !layers.canAdd;
        el.duplicate.disabled = !layers.canAdd;
        el.remove.disabled = !layers.canRemove;
        el.up.disabled = layers.activeIndex >= layers.layers.length - 1;
        el.down.disabled = layers.activeIndex <= 0;
        const percent = Math.round(layers.active.opacity * kPercent);
        el.opacity.value = String(percent);
        el.opacityLabel.textContent = `${percent}%`;
    }

    createRow(layer, index)
    {
        const row = document.createElement('li');
        row.className = 'layer-row';
        row.classList.toggle('is-active', index === this.layers.activeIndex);
        row.classList.toggle('is-hidden', !layer.isVisible);
        row.append(this.createVisibilityToggle(layer), LayerPanel.createName(layer));
        row.addEventListener('click', () => this.select(index));
        row.addEventListener('dblclick', () => this.rename(layer));
        return row;
    }

    createVisibilityToggle(layer)
    {
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = layer.isVisible;
        toggle.title = '表示する';
        // 行のクリック（レイヤーを選ぶ）と分けるため、ここで止める
        toggle.addEventListener('click', (e) => e.stopPropagation());
        toggle.addEventListener('change', () => {
            layer.isVisible = toggle.checked;
            this.render();
            this.handlers.onChange();
        });
        return toggle;
    }

    static createName(layer)
    {
        const name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = layer.name;
        name.title = 'ダブルクリックで名前を変える';
        return name;
    }

    select(index)
    {
        if (index === this.layers.activeIndex) return;
        this.layers.setActive(index);
        this.render();
        this.handlers.onChange();
    }

    rename(layer)
    {
        const input = window.prompt('レイヤーの名前', layer.name);
        if (input === null) return;
        const name = input.trim().slice(0, kMaxLayerNameLength);
        if (name === '') return;
        layer.name = name;
        this.render();
        this.handlers.onChange();
    }
}
