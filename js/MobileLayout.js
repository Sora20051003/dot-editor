'use strict';

const kToolLabels = Object.freeze({
    pen: 'ペン',
    eraser: '消しゴム',
    fill: '塗る',
    picker: 'スポイト',
    line: '直線',
    rect: '四角',
});

// スマホ（狭い画面）用の下のボタン列。押すと「道具」「色」「レイヤー」「操作」の欄を下から出す。
// どの欄を出しているかは body の data-sheet に入れ、見た目の切り替えは CSS に任せる（広い画面では何も起きない）
class MobileLayout
{
    // handlers: onUndo(), onRedo()
    constructor(handlers)
    {
        this.nav = document.getElementById('mobileNav');
        for (const button of this.nav.querySelectorAll('[data-sheet]')) {
            button.addEventListener('click', () => this.toggleSheet(button.dataset.sheet));
        }
        document.getElementById('btnMobileUndo').addEventListener('click', () => handlers.onUndo());
        document.getElementById('btnMobileRedo').addEventListener('click', () => handlers.onRedo());
        // 道具を選んだらすぐ描けるよう、道具の欄は閉じる
        for (const button of document.querySelectorAll('[data-tool]')) {
            button.addEventListener('click', () => this.closeSheet());
        }
        // 描く場所に触れたら欄を閉じる（欄が絵を隠したまま描かないように）
        document.getElementById('stage').addEventListener('pointerdown', () => this.closeSheet());
    }

    get openSheet()
    {
        return document.body.dataset.sheet || '';
    }

    toggleSheet(sheet)
    {
        document.body.dataset.sheet = this.openSheet === sheet ? '' : sheet;
        this.markOpenButton();
    }

    closeSheet()
    {
        if (this.openSheet === '') return;
        document.body.dataset.sheet = '';
        this.markOpenButton();
    }

    markOpenButton()
    {
        for (const button of this.nav.querySelectorAll('[data-sheet]')) {
            button.classList.toggle('is-active', button.dataset.sheet === this.openSheet);
        }
    }

    refresh(toolId, primaryColor, canUndo, canRedo)
    {
        document.getElementById('mobileToolName').textContent = kToolLabels[toolId] || '';
        ColorPanel.paintChip(document.getElementById('mobileColorChip'), primaryColor);
        document.getElementById('btnMobileUndo').disabled = !canUndo;
        document.getElementById('btnMobileRedo').disabled = !canRedo;
    }
}
