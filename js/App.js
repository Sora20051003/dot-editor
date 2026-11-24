'use strict';

const kDefaultCanvasSize = 32;
// 取り消し履歴に使ってよいメモリ。4096×4096 を1回塗りつぶすと約 200MB。
// 8192×8192 の全体を塗ると1回で超えるが、直前の1操作は必ず残す（EditHistory.trimToBudget）
const kHistoryMaxBytes = 512 * 1024 * 1024;
const kMessageDurationMs = 4000;
const kDefaultBaseName = 'dotart';
// コマの小さな絵をどこまで描き直すか
const ThumbnailScope = Object.freeze({ None: 0, Current: 1, All: 2 });

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
        // アニメのコマ。コマを替えると this.layers の中身が入れ替わる
        this.frames = new FrameSet(this.layers);
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
        this.framePanel = new FramePanel(this.frames, this.createFrameHandlers());
        this.player = new AnimationPlayer((steps) => this.onPlayerStep(steps));
        this.isOnionVisible = false;
        this.thumbnailScope = ThumbnailScope.All;
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
        // コマの帯の高さで描く場所の大きさが決まるので、帯を先に作ってから全体表示を計算する
        this.framePanel.render();
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

    createFrameHandlers()
    {
        return {
            onSelect: (index) => this.selectFrame(index),
            onAdd: () => this.runFrameAction(() => this.frames.addFrame(), true),
            onDuplicate: () => this.runFrameAction(() => this.frames.duplicateFrame(), true),
            onRemove: () => this.removeFrame(),
            onMove: (direction) => this.runFrameAction(() => this.frames.moveFrame(direction), false),
            onTogglePlay: () => this.togglePlay(),
            onFpsChange: (value) => this.setFps(value),
            onOnionChange: (isOn) => {
                this.isOnionVisible = isOn;
                this.requestRender();
            },
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
        this.byId('btnSaveFrames').addEventListener('click', () => this.saveFrames());
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
        // 再生中は、どのコマに描いたか分からなくなるので、描かずに止めるだけにする
        if (this.player.isPlaying) {
            this.stopPlaying();
            this.updateUi();
            return;
        }
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
        } else if (key === ',' || key === '.') {
            this.selectFrame(this.frames.currentIndex + (key === '.' ? 1 : -1));
        } else if (key === 'enter' && !(e.target instanceof HTMLButtonElement)) {
            // ボタンにフォーカスがあるときの Enter はそのボタンを押すので、ここでは何もしない
            this.togglePlay();
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
        this.applyHistory(false);
    }

    redo()
    {
        this.applyHistory(true);
    }

    // ほかのコマへの操作なら、そのコマに移ってから戻す（見えない所の絵が変わると分からないため）
    applyHistory(isRedo)
    {
        const canvas = this.history.peekCanvas(isRedo);
        if (this.tools.isActive || canvas === null) return;
        this.stopPlaying();
        const frameIndex = this.frames.indexOfCanvas(canvas);
        const isOtherFrame = frameIndex >= 0 && frameIndex !== this.frames.currentIndex;
        if (isOtherFrame) {
            this.frames.select(frameIndex);
            this.layerPanel.render();
        }
        const isDone = isRedo ? this.history.redo() : this.history.undo();
        if (!isDone) return;
        if (isOtherFrame) {
            this.showMessage(`コマ ${frameIndex + 1} の操作を${isRedo ? 'やり直しました' : '取り消しました'}`);
        }
        this.isUnsaved = true;
        this.updateUi();
    }

    // ---- アニメのコマ ----

    canChangeFrames()
    {
        return !this.tools.isActive && !this.player.isPlaying;
    }

    selectFrame(index)
    {
        if (this.tools.isActive) return;
        this.stopPlaying();
        if (!this.frames.select(index)) {
            this.updateUi();
            return;
        }
        this.afterFrameChanged(false);
    }

    // isAdding：足せなかったときに理由を出すか
    runFrameAction(action, isAdding)
    {
        if (!this.canChangeFrames()) return;
        if (!action()) {
            if (isAdding) this.showMessage(this.frames.addLimitMessage);
            return;
        }
        this.isUnsaved = true;
        this.afterFrameChanged(true);
    }

    removeFrame()
    {
        if (!this.canChangeFrames() || this.frames.count <= 1) return;
        const number = this.frames.currentIndex + 1;
        if (!window.confirm(`コマ ${number} を削除しますか？（取り消しできません）`)) return;
        const removedLayers = this.frames.removeFrame();
        for (const layer of removedLayers) this.history.removeCanvas(layer.canvas);
        this.isUnsaved = true;
        this.afterFrameChanged(true);
    }

    // isListChanged：コマの数か並びが変わった（帯を作り直す）
    afterFrameChanged(isListChanged)
    {
        if (isListChanged) {
            this.framePanel.render();
            this.thumbnailScope = ThumbnailScope.All;
        }
        this.layerPanel.render();
        this.updateUi();
    }

    togglePlay()
    {
        if (this.player.isPlaying) {
            this.stopPlaying();
            this.updateUi();
            return;
        }
        if (this.tools.isActive || this.frames.count <= 1) return;
        this.player.play(this.frames.fps);
        this.updateUi();
    }

    stopPlaying()
    {
        if (this.player.isPlaying) this.player.stop();
    }

    onPlayerStep(steps)
    {
        this.frames.selectNext(steps);
        this.afterFrameChanged(false);
    }

    setFps(value)
    {
        this.frames.setFps(value);
        this.isUnsaved = true;
        if (this.player.isPlaying) this.player.play(this.frames.fps);
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
        const problem = isKeepContent ? this.frames.checkResize(width, height) : null;
        if (problem !== null) {
            this.showMessage(problem);
            return;
        }
        if (!isKeepContent && !this.confirmDiscard()) return;
        this.stopPlaying();
        if (isKeepContent) {
            this.frames.resize(width, height);
        } else {
            this.layers.resetDefault(width, height);
            this.frames.resetToCurrent();
            this.baseName = kDefaultBaseName;
            this.saveTarget.clear();
        }
        this.afterDocumentReplaced(isKeepContent);
        this.showMessage(`${width}×${height} マスにしました`);
    }

    afterDocumentReplaced(isUnsaved)
    {
        this.stopPlaying();
        this.history.clear();
        this.isUnsaved = isUnsaved;
        this.framePanel.render();
        this.thumbnailScope = ThumbnailScope.All;
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
            this.stopPlaying();
            if (isProject) {
                this.frames.restore(await ProjectFile.decode(file));
            } else {
                this.layers.resetWithImage(await ImageFile.readImage(file));
                this.frames.resetToCurrent();
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
            const frameNote = this.frames.count > 1 ? `コマ ${this.frames.currentIndex + 1} だけ、` : '';
            this.showMessage(`${fileName} を保存しました（${frameNote}${scale} 倍）`);
        } catch (error) {
            this.showMessage(`保存できませんでした：${error.message}`);
        }
    }

    // 全コマを PNG にして ZIP で保存する
    async saveFrames()
    {
        if (this.tools.isActive) return;
        const scale = Number(this.byId('exportScale').value);
        const count = this.frames.count;
        const sources = Array.from({ length: count }, (_, i) => this.frames.frameImageSource(i));
        this.showMessage(`${count} コマを PNG にしています…`);
        try {
            await ImageFile.saveFramesZip(sources, scale, this.baseName);
            this.showMessage(`${this.baseName}_frames.zip を保存しました（${count} コマ、${scale} 倍）`);
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
            const blob = await ProjectFile.encode(this.frames);
            const savedName = await this.saveTarget.save(blob, ProjectFile.toProjectFileName(this.baseName));
            this.baseName = savedName.replace(/\.[^.]*$/, '');
            this.isUnsaved = false;
            const frameNote = this.frames.count > 1 ? `コマ ${this.frames.count}、` : '';
            this.showMessage(`${savedName} に保存しました（${frameNote}レイヤー ${this.frames.totalLayerCount()} 枚）`);
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
        const frameText = this.frames.count > 1 ? `コマ ${this.frames.currentIndex + 1}/${this.frames.count}・` : '';
        this.byId('statusLayer').textContent = `${frameText}描く先：${this.layers.active.name}`;
        this.framePanel.refresh(this.player.isPlaying);
        // 再生中は絵が変わらないので、小さな絵は描き直さない
        if (!this.player.isPlaying) this.thumbnailScope = Math.max(this.thumbnailScope, ThumbnailScope.Current);
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
            this.view.syncDirty(this.layers, this.frames.allLayers());
            this.view.render(this.layers, this.cursor, this.onionLayers());
            this.drawPendingThumbnails();
        });
    }

    // 薄く重ねる前のコマ。描くときの目安なので、再生中と最初のコマでは出さない
    onionLayers()
    {
        const index = this.frames.currentIndex;
        if (!this.isOnionVisible || this.player.isPlaying || index === 0) return null;
        return this.frames.layersOf(index - 1);
    }

    drawPendingThumbnails()
    {
        if (this.thumbnailScope === ThumbnailScope.None) return;
        const indices = this.thumbnailScope === ThumbnailScope.All ? null : [this.frames.currentIndex];
        this.thumbnailScope = ThumbnailScope.None;
        this.framePanel.drawThumbnails(
            (ctx, index, width, height) => this.view.drawThumbnail(ctx, this.frames.layersOf(index), width, height),
            indices);
    }
}

new App();
