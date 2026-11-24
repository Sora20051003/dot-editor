'use strict';

const kMinCanvasSize = 1;

// マス目の数（横・縦）を決めるダイアログ。1〜kMaxCanvasSize マス
class CanvasSizeDialog
{
    // onConfirm(width, height, isKeepContent)
    constructor(onConfirm)
    {
        this.onConfirm = onConfirm;
        this.dialog = document.getElementById('sizeDialog');
        this.widthInput = document.getElementById('inWidth');
        this.heightInput = document.getElementById('inHeight');
        this.lockInput = document.getElementById('chkSquare');
        this.widthInput.max = String(kMaxCanvasSize);
        this.heightInput.max = String(kMaxCanvasSize);
        // iPhone・iPad では上限が低いので、超えるボタンは隠す
        for (const button of this.dialog.querySelectorAll('[data-size]')) {
            button.hidden = Number(button.dataset.size) > kMaxCanvasSize;
        }
        document.getElementById('sizeLimitHint').textContent =
            `1〜${kMaxCanvasSize} マスまで。変えると取り消しの履歴は消えます`;
        this.bindEvents();
    }

    bindEvents()
    {
        this.dialog.addEventListener('close', () => this.onClose());
        this.widthInput.addEventListener('input', () => this.syncSquare(this.widthInput, this.heightInput));
        this.heightInput.addEventListener('input', () => this.syncSquare(this.heightInput, this.widthInput));
        for (const button of this.dialog.querySelectorAll('[data-size]')) {
            button.addEventListener('click', () => this.applyPreset(Number(button.dataset.size)));
        }
    }

    open(currentWidth, currentHeight)
    {
        this.widthInput.value = String(currentWidth);
        this.heightInput.value = String(currentHeight);
        this.lockInput.checked = currentWidth === currentHeight;
        // Esc で閉じたときは returnValue が前回のまま残るので空にしておく
        this.dialog.returnValue = '';
        this.dialog.showModal();
        this.widthInput.select();
    }

    applyPreset(size)
    {
        this.widthInput.value = String(size);
        this.heightInput.value = String(size);
    }

    syncSquare(source, target)
    {
        if (this.lockInput.checked) target.value = source.value;
    }

    onClose()
    {
        if (this.dialog.returnValue !== 'ok') return;
        const width = CanvasSizeDialog.clampSize(this.widthInput.value);
        const height = CanvasSizeDialog.clampSize(this.heightInput.value);
        const mode = this.dialog.querySelector('input[name="sizeMode"]:checked').value;
        this.onConfirm(width, height, mode === 'keep');
    }

    static clampSize(text)
    {
        const value = Math.round(Number(text));
        if (!Number.isFinite(value)) return kMinCanvasSize;
        return Math.min(kMaxCanvasSize, Math.max(kMinCanvasSize, value));
    }
}
