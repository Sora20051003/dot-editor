'use strict';

// 通信モードの絵は小さいので、取り消し履歴も少しで足りる
const kGameHistoryBytes = 32 * 1024 * 1024;
const kGameMaxBrushSize = 16;
const kGameDefaultColor = ColorUtil.pack(0, 0, 0, 255);

const kGameToolKeys = Object.freeze({ b: ToolId.Pen, e: ToolId.Eraser, g: ToolId.Fill });

// 通信モードで描く場所。エディタの部品（Painter・ToolController・ViewRenderer・CanvasInput）を使い回す。
// 白い紙に描き、右クリックと消しゴムは白で塗る
class GameDrawPad
{
    // onChange(): 絵が変わったとき（描いている途中も呼ぶ。送る間隔は呼ぶ側で間引く）
    constructor(onChange)
    {
        this.onChange = onChange;
        this.stage = document.getElementById('drawStage');
        this.layers = new LayerStack(kGameCanvasSizes[0], kGameCanvasSizes[0]);
        this.history = new EditHistory(kGameHistoryBytes);
        this.painter = new Painter(this.layers, this.history);
        this.tools = new ToolController(this.layers, this.history, this.painter, (color) => this.setColor(color));
        this.tools.eraserColor = kBlankColor;
        this.view = new ViewRenderer(document.getElementById('drawView'), this.stage);
        this.input = new CanvasInput(this.stage, this.view, this.createInputHandlers());
        this.color = kGameDefaultColor;
        this.picker = new ColorPicker(document.getElementById('drawColorPicker'), (color) => this.setColor(color));
        this.cursor = null;
        this.isEnabled = false;
        this.isRenderQueued = false;
        this.bindTools();
        this.buildPalette();
        new ResizeObserver(() => this.fitView()).observe(this.stage);
    }

    get size()
    {
        return this.layers.width;
    }

    get pixels()
    {
        return this.layers.activeCanvas.pixels;
    }

    createInputHandlers()
    {
        return {
            onDrawBegin: (x, y, modifiers) => this.onDrawBegin(x, y, modifiers),
            onDrawMove: (x, y) => {
                if (!this.tools.isActive) return;
                this.tools.move(x, y);
                this.changed();
            },
            onDrawEnd: () => {
                if (!this.tools.isActive) return;
                this.tools.end();
                this.changed();
            },
            onDrawCancel: () => {
                this.tools.cancel();
                this.changed();
            },
            onTwoFingerTap: () => this.undo(),
            onHover: (pixel) => {
                this.cursor = pixel === null ? null : { x: pixel.x, y: pixel.y, brush: this.tools.cursorBrush };
                this.requestRender();
            },
            onViewChanged: () => this.requestRender(),
        };
    }

    // 新しい白紙にする（描く場面が始まるたびに呼ぶ）
    reset(size)
    {
        this.layers.resetWithImage(new ImageData(size, size));
        this.layers.activeCanvas.pixels.fill(kBlankColor);
        this.layers.activeCanvas.markAllDirty();
        this.history.clear();
        this.isEnabled = true;
        this.fitView();
        this.updateButtons();
    }

    setEnabled(isEnabled)
    {
        this.isEnabled = isEnabled;
        if (!isEnabled && this.tools.isActive) this.tools.end();
    }

    fitView()
    {
        this.view.resizeToContainer();
        this.view.fitTo(this.size, this.size);
        this.requestRender();
    }

    onDrawBegin(x, y, modifiers)
    {
        if (!this.isEnabled) return;
        const color = modifiers.isSecondary ? kBlankColor : this.color;
        this.tools.begin(x, y, color, modifiers.isSecondary, modifiers.isAlt ? ToolId.Picker : null);
        this.changed();
    }

    changed()
    {
        this.updateButtons();
        this.requestRender();
        this.onChange();
    }

    byId(id)
    {
        return document.getElementById(id);
    }

    bindTools()
    {
        for (const button of document.querySelectorAll('[data-game-tool]')) {
            button.addEventListener('click', () => this.selectTool(button.dataset.gameTool));
        }
        this.byId('btnDrawUndo').addEventListener('click', () => this.undo());
        this.byId('btnDrawRedo').addEventListener('click', () => this.redo());
        this.byId('btnDrawClear').addEventListener('click', () => this.clearAll());
        const sizeInput = this.byId('drawBrushSize');
        sizeInput.max = String(kGameMaxBrushSize);
        sizeInput.addEventListener('input', () => this.setBrushSize(sizeInput.value));
        for (const radio of document.querySelectorAll('input[name="drawBrushShape"]')) {
            radio.addEventListener('change', () => this.tools.setBrushShape(radio.value));
        }
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    onKeyDown(e)
    {
        if (!this.isEnabled || this.stage.offsetParent === null || CanvasInput.isTypingTarget(e.target)) return;
        const key = e.key.toLowerCase();
        if (e.ctrlKey || e.metaKey) {
            if (key !== 'z' && key !== 'y') return;
            e.preventDefault();
            if (key === 'y' || e.shiftKey) this.redo(); else this.undo();
            return;
        }
        if (kGameToolKeys[key]) this.selectTool(kGameToolKeys[key]);
    }

    selectTool(toolId)
    {
        this.tools.toolId = toolId;
        for (const button of document.querySelectorAll('[data-game-tool]')) {
            button.classList.toggle('is-active', button.dataset.gameTool === toolId);
        }
    }

    setBrushSize(value)
    {
        this.tools.setBrushSize(Math.min(kGameMaxBrushSize, Number(value)));
        this.byId('drawBrushSizeLabel').textContent = String(this.tools.brushSize);
    }

    setColor(color)
    {
        this.color = color;
        ColorPanel.paintChip(this.byId('drawColorChip'), color);
        this.picker.setColor(color);
    }

    // 灰色と色とりどりのプリセット（透明は使わない：白い紙の上に描くため）
    buildPalette()
    {
        const container = this.byId('drawPalette');
        for (const color of ColorPanel.buildPresetColors()) {
            if (color === ColorUtil.kTransparent) continue;
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'chip palette-cell';
            cell.title = ColorUtil.toHex(color);
            ColorPanel.paintChip(cell, color);
            cell.addEventListener('click', () => this.setColor(color));
            container.appendChild(cell);
        }
        this.setColor(this.color);
    }

    undo()
    {
        if (!this.isEnabled || !this.history.canUndo) return;
        this.history.undo();
        this.changed();
    }

    redo()
    {
        if (!this.isEnabled || !this.history.canRedo) return;
        this.history.redo();
        this.changed();
    }

    clearAll()
    {
        if (!this.isEnabled) return;
        this.history.begin(this.layers.activeCanvas);
        this.painter.fillRect(0, 0, this.size - 1, this.size - 1, kBlankColor);
        if (this.history.commit()) this.changed();
    }

    updateButtons()
    {
        this.byId('btnDrawUndo').disabled = !this.history.canUndo;
        this.byId('btnDrawRedo').disabled = !this.history.canRedo;
    }

    requestRender()
    {
        if (this.isRenderQueued) return;
        this.isRenderQueued = true;
        requestAnimationFrame(() => {
            this.isRenderQueued = false;
            this.view.syncDirty(this.layers);
            this.view.render(this.layers, this.isEnabled ? this.cursor : null);
        });
    }
}
