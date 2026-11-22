'use strict';

const kDefaultCanvasSize = 32;
// 取り消し履歴に使ってよいメモリ。4096×4096 を1回塗りつぶすと約 200MB
const kHistoryMaxBytes = 512 * 1024 * 1024;
const kMessageDurationMs = 4000;
const kDefaultBaseName = 'dotart';

const kToolKeys = Object.freeze({
    b: ToolId.Pen,
    e: ToolId.Eraser,
    g: ToolId.Fill,
    i: ToolId.Picker,
    l: ToolId.Line,
    r: ToolId.Rect,
});

// 部品を組み立てて、ボタン・キー操作と描画の更新をつなぐ
class App
{
    constructor()
    {
        this.layers = new LayerStack(kDefaultCanvasSize, kDefaultCanvasSize);
        this.history = new EditHistory(kHistoryMaxBytes);
        this.painter = new Painter(this.layers, this.history);
        // 色が変わったらスマホの下のボタン列の色も変えるので、画面全体を更新する
        this.colorPanel = new ColorPanel(() => this.updateUi());
        this.tools = new ToolController(
            this.layers, this.history, this.painter,
            (color, isSecondary) => this.colorPanel.setColor(isSecondary, color));
        this.layerPanel = new LayerPanel(this.layers, {
            onChange: () => this.updateUi(),
            onRemoveRequest: () => this.removeActiveLayer(),
            onMessage: (text) => this.showMessage(text),
        });
        this.stage = document.getElementById('stage');
        this.view = new ViewRenderer(document.getElementById('view'), this.stage);
        this.sizeDialog = new CanvasSizeDialog((w, h, isKeep) => this.applyCanvasSize(w, h, isKeep));
        this.input = new CanvasInput(this.stage, this.view, this.createInputHandlers());
        this.mobile = new MobileLayout({ onUndo: () => this.undo(), onRedo: () => this.redo() });
        this.cursor = null;
        this.isRenderQueued = false;
        this.isUnsaved = false;
        // 保存するファイル名の拡張子を除いた部分。PNG と作業ファイルで共通にする
        this.baseName = kDefaultBaseName;
        this.saveTarget = new ProjectSaveTarget();
        this.messageTimer = 0;

        this.bindToolbar();
        this.bindToolPanel();
        this.bindWindow();
        this.view.resizeToContainer();
        this.view.fitTo(this.layers.width, this.layers.height);
        this.updateUi();
    }

    createInputHandlers()
    {
        return {
            onDrawBegin: (x, y, modifiers) => this.onDrawBegin(x, y, modifiers),
            onDrawMove: (x, y) => {
                this.tools.move(x, y);
                this.requestRender();
            },
            onDrawEnd: () => this.onDrawEnd(),
            onDrawCancel: () => {
                this.tools.cancel();
                this.updateUi();
            },
            onHover: (pixel) => this.onHover(pixel),
            onViewChanged: () => this.updateUi(),
            // スマホで2本指で軽くたたくと取り消し（キーボードがないため）
            onTwoFingerTap: () => this.undo(),
        };
    }

    byId(id)
    {
        return document.getElementById(id);
    }

    bindToolbar()
    {
        this.byId('btnNew').addEventListener('click', () => this.openSizeDialog());
        this.byId('btnOpen').addEventListener('click', () => this.chooseFile());
        this.byId('fileInput').addEventListener('change', (e) => this.onFileChosen(e.target));
        this.byId('btnSave').addEventListener('click', () => this.save());
        this.byId('btnSaveProject').addEventListener('click', (e) => this.saveProject(e.shiftKey));
        this.byId('btnUndo').addEventListener('click', () => this.undo());
        this.byId('btnRedo').addEventListener('click', () => this.redo());
        this.byId('btnFlipH').addEventListener('click', () => this.flip(true));
        this.byId('btnFlipV').addEventListener('click', () => this.flip(false));
        this.byId('chkGrid').addEventListener('change', (e) => this.setGridVisible(e.target.checked));
        this.byId('gridMajor').addEventListener('change', (e) => {
            this.view.majorGridStep = Number(e.target.value);
            this.requestRender();
        });
        this.byId('btnZoomIn').addEventListener('click', () => this.stepZoom(1));
        this.byId('btnZoomOut').addEventListener('click', () => this.stepZoom(-1));
        this.byId('btnFit').addEventListener('click', () => this.fitView());
        // 描きかけの絵を消さないよう、通信モードは新しいタブで開く
        this.byId('btnPlay').addEventListener('click', () => window.open('play.html', '_blank'));
    }

    bindToolPanel()
    {
        for (const button of document.querySelectorAll('[data-tool]')) {
            button.addEventListener('click', () => this.selectTool(button.dataset.tool));
        }
        for (const id of ['brushSize', 'brushSizeRange']) {
            const input = this.byId(id);
            input.min = String(kMinBrushSize);
            input.max = String(kMaxBrushSize);
            input.addEventListener('input', () => this.setBrushSize(input.value));
        }
        for (const radio of document.querySelectorAll('input[name="brushShape"]')) {
            radio.addEventListener('change', () => this.setBrushShape(radio.value));
        }
        this.byId('chkRectFill').addEventListener('change', (e) => {
            this.tools.isRectFilled = e.target.checked;
        });
    }

    bindWindow()
    {
        new ResizeObserver(() => {
            this.view.resizeToContainer();
            this.updateUi();
        }).observe(this.stage);
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        // 保存せずに閉じて絵が消えるのを防ぐ
        window.addEventListener('beforeunload', (e) => {
            if (this.isUnsaved) e.preventDefault();
        });
        // exe 版（desktop/）は窓を閉じるときにこれを呼んで確かめる（beforeunload が出ないため）
        window.dotAppUnsavedMessage = () => (this.isUnsaved ? '保存していない絵があります。' : '');
    }

    onDrawBegin(x, y, modifiers)
    {
        const color = this.colorPanel.getColor(modifiers.isSecondary);
        const override = modifiers.isAlt ? ToolId.Picker : null;
        const isPicking = (override || this.tools.toolId) === ToolId.Picker;
        if (!isPicking && !this.ensureActiveLayerVisible()) return;
        this.tools.begin(x, y, color, modifiers.isSecondary, override);
        this.requestRender();
    }

    // 見えないレイヤーに描くと、何が起きたか分からなくなるので止める
    ensureActiveLayerVisible()
    {
        if (this.layers.active.isVisible) return true;
        this.showMessage(`「${this.layers.active.name}」は非表示なので変えられません`);
        return false;
    }

    onDrawEnd()
    {
        const result = this.tools.end();
        if (result.hasChanged) {
            this.isUnsaved = true;
            if (result.toolId !== ToolId.Eraser) this.colorPanel.addRecent(result.color);
        }
        this.updateUi();
    }

    onHover(pixel)
    {
        this.cursor = pixel === null ? null : { x: pixel.x, y: pixel.y, brush: this.tools.cursorBrush };
        this.updateStatusPosition();
        this.requestRender();
    }

    onKeyDown(e)
    {
        if (CanvasInput.isTypingTarget(e.target) || this.byId('sizeDialog').open) return;
        if (e.ctrlKey || e.metaKey) {
            this.handleCtrlShortcut(e);
            return;
        }
        const key = e.key.toLowerCase();
        if (kToolKeys[key]) {
            this.selectTool(kToolKeys[key]);
        } else if (key === 'x') {
            this.colorPanel.swap();
        } else if (key === 'h' || key === 'v') {
            this.flip(key === 'h');
        } else if (key === '+' || key === ';' || key === '=') {
            this.stepZoom(1);
        } else if (key === '-') {
            this.stepZoom(-1);
        } else if (key === '0') {
            this.fitView();
        } else if (key === '[' || key === ']') {
            this.setBrushSize(this.tools.brushSize + (key === ']' ? 1 : -1));
        }
    }

    handleCtrlShortcut(e)
    {
        const key = e.key.toLowerCase();
        const actions = {
            z: () => (e.shiftKey ? this.redo() : this.undo()),
            y: () => this.redo(),
            s: () => this.saveProject(e.shiftKey),
            o: () => this.chooseFile(),
        };
        if (!actions[key]) return;
        e.preventDefault();
        actions[key]();
    }

    selectTool(toolId)
    {
        this.tools.toolId = toolId;
        for (const button of document.querySelectorAll('[data-tool]')) {
            button.classList.toggle('is-active', button.dataset.tool === toolId);
        }
        this.refreshCursor();
        this.updateUi();
    }

    setBrushSize(value)
    {
        this.tools.setBrushSize(value);
        // 入力中の欄を書き換えると打ちかけの数字が消えるので、値が違う欄だけ直す
        for (const id of ['brushSize', 'brushSizeRange']) {
            const input = this.byId(id);
            if (Number(input.value) !== this.tools.brushSize) input.value = this.tools.brushSize;
        }
        this.refreshCursor();
    }

    setBrushShape(shapeId)
    {
        this.tools.setBrushShape(shapeId);
        for (const radio of document.querySelectorAll('input[name="brushShape"]')) {
            radio.checked = radio.value === this.tools.brushShapeId;
        }
        this.refreshCursor();
    }

    refreshCursor()
    {
        if (this.cursor !== null) this.cursor.brush = this.tools.cursorBrush;
        this.requestRender();
    }

    setGridVisible(isVisible)
    {
        this.view.isGridVisible = isVisible;
        this.requestRender();
    }

    stepZoom(direction)
    {
        this.view.stepZoomAtCenter(direction);
        this.updateUi();
    }

    fitView()
    {
        this.view.fitTo(this.layers.width, this.layers.height);
        this.updateUi();
    }

    undo()
    {
        if (this.tools.isActive || !this.history.undo()) return;
        this.isUnsaved = true;
        this.updateUi();
    }

    redo()
    {
        if (this.tools.isActive || !this.history.redo()) return;
        this.isUnsaved = true;
        this.updateUi();
    }

    // 選んでいるレイヤーだけを反転する。
    // 描いている途中に反転すると、下書きの戻し先がずれるので受け付けない
    flip(isHorizontal)
    {
        if (this.tools.isActive || !this.ensureActiveLayerVisible()) return;
        this.history.begin(this.layers.activeCanvas);
        if (isHorizontal) {
            this.painter.flipHorizontal();
        } else {
            this.painter.flipVertical();
        }
        if (!this.history.commit()) return;
        this.isUnsaved = true;
        this.updateUi();
    }

    removeActiveLayer()
    {
        const name = this.layers.active.name;
        if (this.tools.isActive || !this.layers.canRemove) return;
        if (!window.confirm(`「${name}」を削除しますか？（取り消しできません）`)) return;
        const removed = this.layers.removeActive();
        this.history.removeCanvas(removed.canvas);
        this.isUnsaved = true;
        this.layerPanel.render();
        this.updateUi();
    }

    openSizeDialog()
    {
        this.sizeDialog.open(this.layers.width, this.layers.height);
    }

    applyCanvasSize(width, height, isKeepContent)
    {
        const maxLayers = LayerStack.maxLayersFor(width, height);
        if (isKeepContent && this.layers.layers.length > maxLayers) {
            this.showMessage(`${width}×${height} ではレイヤーは ${maxLayers} 枚までです。先に減らしてください`);
            return;
        }
        if (!isKeepContent && !this.confirmDiscard()) return;
        if (isKeepContent) {
            this.layers.resize(width, height);
        } else {
            this.layers.resetDefault(width, height);
            this.baseName = kDefaultBaseName;
            this.saveTarget.clear();
        }
        this.afterDocumentReplaced(isKeepContent);
        this.showMessage(`${width}×${height} マスにしました`);
    }

    afterDocumentReplaced(isUnsaved)
    {
        this.history.clear();
        this.isUnsaved = isUnsaved;
        this.layerPanel.render();
        this.fitView();
    }

    confirmDiscard()
    {
        return !this.isUnsaved || window.confirm('保存していない絵は消えます。続けますか？');
    }

    // 開いた作業ファイルにそのまま上書き保存できるよう、使えるならファイルの場所（handle）ごと受け取る
    async chooseFile()
    {
        if (typeof window.showOpenFilePicker !== 'function') {
            this.byId('fileInput').click();
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({ types: App.openFileTypes() });
            await this.openFile(await handle.getFile(), handle);
        } catch (error) {
            if (error.name !== 'AbortError') this.showMessage(`開けませんでした：${error.message}`);
        }
    }

    static openFileTypes()
    {
        return [{
            description: '作業ファイル・画像',
            accept: {
                'application/octet-stream': [kProjectExtension],
                'image/*': ['.png', '.gif', '.bmp', '.webp', '.jpg', '.jpeg'],
            },
        }];
    }

    onFileChosen(input)
    {
        const file = input.files[0];
        input.value = '';
        if (file) this.openFile(file, null);
    }

    async openFile(file, handle)
    {
        if (!this.confirmDiscard()) return;
        try {
            const isProject = ProjectFile.isProjectFileName(file.name);
            if (isProject) {
                this.layers.restore(await ProjectFile.decode(file));
            } else {
                this.layers.resetWithImage(await ImageFile.readImage(file));
            }
            // 画像を開いたときは、上書きで元の画像を壊さないよう保存先を覚えない
            this.saveTarget.setHandle(isProject ? handle : null);
            this.baseName = file.name.replace(/\.[^.]*$/, '');
            this.afterDocumentReplaced(false);
            this.showMessage(`${file.name} を開きました`);
        } catch (error) {
            this.showMessage(`開けませんでした：${error.message}`);
        }
    }

    async save()
    {
        const scale = Number(this.byId('exportScale').value);
        const fileName = `${this.baseName}.png`;
        try {
            await ImageFile.savePng(this.layers, scale, fileName);
            this.showMessage(`${fileName} を保存しました（${scale} 倍）`);
        } catch (error) {
            this.showMessage(`保存できませんでした：${error.message}`);
        }
    }

    // isSaveAs が true なら、上書きせずに保存場所を選び直す
    async saveProject(isSaveAs)
    {
        if (this.tools.isActive) return;
        if (isSaveAs) this.saveTarget.clear();
        try {
            const blob = await ProjectFile.encode(this.layers);
            const savedName = await this.saveTarget.save(blob, ProjectFile.toProjectFileName(this.baseName));
            this.baseName = savedName.replace(/\.[^.]*$/, '');
            this.isUnsaved = false;
            this.showMessage(`${savedName} に保存しました（レイヤー ${this.layers.layers.length} 枚）`);
        } catch (error) {
            if (error.name !== 'AbortError') this.showMessage(`保存できませんでした：${error.message}`);
        }
    }

    showMessage(text)
    {
        const element = this.byId('statusMessage');
        element.textContent = text;
        clearTimeout(this.messageTimer);
        this.messageTimer = setTimeout(() => (element.textContent = ''), kMessageDurationMs);
    }

    updateUi()
    {
        this.byId('btnUndo').disabled = !this.history.canUndo;
        this.byId('btnRedo').disabled = !this.history.canRedo;
        this.mobile.refresh(this.tools.toolId, this.colorPanel.getColor(false), this.history.canUndo, this.history.canRedo);
        this.byId('zoomLabel').textContent = `${Math.round(this.view.zoom * 100)}%`;
        this.byId('statusSize').textContent = `${this.layers.width} × ${this.layers.height} マス`;
        this.byId('statusLayer').textContent = `描く先：${this.layers.active.name}`;
        this.updateStatusPosition();
        this.requestRender();
    }

    updateStatusPosition()
    {
        const cursor = this.cursor;
        const isInside = cursor !== null && this.layers.isInside(cursor.x, cursor.y);
        this.byId('statusPos').textContent = isInside ? `X ${cursor.x}, Y ${cursor.y}` : '';
        this.byId('statusColor').textContent = isInside
            ? `この色：${ColorUtil.toHex(this.layers.pickVisibleColor(cursor.x, cursor.y))}`
            : '';
    }

    // 1フレームに何度呼ばれても描くのは1回にする
    requestRender()
    {
        if (this.isRenderQueued) return;
        this.isRenderQueued = true;
        requestAnimationFrame(() => {
            this.isRenderQueued = false;
            this.view.syncDirty(this.layers);
            this.view.render(this.layers, this.cursor);
        });
    }
}

new App();
