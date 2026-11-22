'use strict';

// 描いている途中の絵を送る間隔。短いほど滑らかだが通信が増える
const kLiveSendIntervalMs = 300;
const kPanelIds = Object.freeze({
    wait: 'panelWait',
    prompt: 'panelPrompt',
    draw: 'panelDraw',
    view: 'panelView',
    chain: 'panelChain',
    final: 'panelFinal',
});

// ゲーム中の画面。ホストから届く「場面（phase）」に合わせてパネルを切り替える。
// 画面の文字はすべて textContent で入れる（相手が送った文字を HTML として扱わないため）
class GameScreen
{
    constructor(sendAction, isHost)
    {
        this.sendAction = sendAction;
        this.isHost = isHost;
        this.phase = null;
        this.isSubmitted = false;
        // 古い場面の非同期処理（絵の読み込み）が、新しい場面の表示を上書きしないための番号
        this.phaseToken = 0;
        this.liveTimer = 0;
        this.side = new GameSidePanel(sendAction);
        this.countdown = new Countdown(this.byId('phaseTimer'));
        this.drawPad = new GameDrawPad(() => this.onDrawChange());
        this.bindEvents();
    }

    byId(id)
    {
        return document.getElementById(id);
    }

    bindEvents()
    {
        this.byId('btnPromptSubmit').addEventListener('click', () => this.submitText(this.byId('promptInput')));
        this.onEnter(this.byId('promptInput'), () => this.submitText(this.byId('promptInput')));
        this.byId('btnViewAnswer').addEventListener('click', () => this.submitText(this.byId('viewAnswerInput')));
        this.onEnter(this.byId('viewAnswerInput'), () => this.submitText(this.byId('viewAnswerInput')));
        this.byId('btnDrawDone').addEventListener('click', () => this.submitDrawing());
        this.byId('btnChainNext').addEventListener('click', () => this.sendAction({ t: 'next' }));
        this.byId('btnToLobby').addEventListener('click', () => this.sendAction({ t: 'toLobby' }));
    }

    onEnter(input, callback)
    {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) callback();
        });
    }

    setScoreVisible(isVisible)
    {
        this.side.isScoreVisible = isVisible;
    }

    // ---- 場面の切り替え ----
    showPhase(phase)
    {
        this.phase = phase;
        this.phaseToken++;
        this.isSubmitted = false;
        this.countdown.stop();
        this.drawPad.setEnabled(false);
        for (const [panel, id] of Object.entries(kPanelIds)) this.byId(id).hidden = panel !== phase.panel;
        this.byId('phaseTitle').textContent = String(phase.title || '');
        this.byId('phaseMessage').textContent = String(phase.message || '');
        this.side.setAnswerEnabled(phase.canGuess === true);
        const show = {
            prompt: () => this.showPrompt(phase),
            draw: () => this.showDraw(phase),
            view: () => this.showView(phase),
            chain: () => this.showChain(phase),
            final: () => this.showFinal(phase),
        }[phase.panel];
        if (show !== undefined) show();
        if (Number(phase.remainingMs) > 0) this.countdown.start(Number(phase.remainingMs), () => this.onTimeUp());
    }

    // 時間切れ：描いた絵・書きかけの言葉はそのまま出す（何も書いていなければホストが代わりを入れる）
    onTimeUp()
    {
        if (this.isSubmitted || this.phase === null) return;
        if (this.phase.panel === 'draw' && !this.phase.isLive) this.submitDrawing();
        if (this.phase.panel === 'prompt') this.submitText(this.byId('promptInput'));
        if (this.phase.panel === 'view' && this.phase.canAnswerOnce) this.submitText(this.byId('viewAnswerInput'));
    }

    showPrompt(phase)
    {
        const container = this.byId('promptChoices');
        container.replaceChildren();
        for (const choice of Array.isArray(phase.choices) ? phase.choices : []) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = String(choice);
            button.addEventListener('click', () => this.sendText(String(choice)));
            container.appendChild(button);
        }
        const input = this.byId('promptInput');
        input.value = '';
        input.maxLength = Number(phase.maxLength) || kMaxPromptLength;
        input.disabled = false;
        input.focus();
    }

    showDraw(phase)
    {
        this.byId('drawPrompt').textContent = String(phase.prompt || '');
        this.byId('btnDrawDone').hidden = phase.isLive === true;
        this.byId('btnDrawDone').disabled = false;
        this.drawPad.reset(Number(phase.size));
        if (phase.isLive) this.sendLiveNow();
    }

    showView(phase)
    {
        const row = this.byId('viewAnswerRow');
        row.hidden = phase.canAnswerOnce !== true;
        const input = this.byId('viewAnswerInput');
        input.value = '';
        input.disabled = false;
        input.maxLength = Number(phase.maxLength) || kMaxPromptLength;
        if (!row.hidden) input.focus();
        this.drawImage(this.byId('viewImage'), phase.image, Number(phase.size));
    }

    // 描いている途中の絵（お題当て）が届いたとき
    onImage(image)
    {
        if (this.phase === null || this.phase.panel !== 'view') return;
        this.drawImage(this.byId('viewImage'), image, Number(this.phase.size));
    }

    async drawImage(canvas, image, size)
    {
        if (!PixelImage.isValidSize(size)) return;
        const token = this.phaseToken;
        const pixels = image ? await PixelImage.decode(image, size) : null;
        if (token !== this.phaseToken) return;
        PixelImageView.draw(canvas, pixels, size);
    }

    // ---- 送信 ----
    sendText(text)
    {
        if (this.isSubmitted || text.trim() === '') return;
        this.isSubmitted = true;
        this.sendAction({ t: 'text', text });
        for (const button of this.byId('promptChoices').querySelectorAll('button')) button.disabled = true;
        this.byId('promptInput').disabled = true;
        this.byId('viewAnswerInput').disabled = true;
    }

    submitText(input)
    {
        this.sendText(input.value);
    }

    async submitDrawing()
    {
        if (this.isSubmitted || this.phase === null || this.phase.panel !== 'draw') return;
        this.isSubmitted = true;
        this.drawPad.setEnabled(false);
        this.byId('btnDrawDone').disabled = true;
        const image = await PixelImage.encode(this.drawPad.pixels, this.drawPad.size);
        this.sendAction({ t: 'drawing', image });
    }

    // お題当てのときだけ、描いている途中の絵を間隔をあけて送る
    onDrawChange()
    {
        if (this.phase === null || this.phase.panel !== 'draw' || !this.phase.isLive) return;
        if (this.liveTimer !== 0) return;
        this.liveTimer = setTimeout(() => {
            this.liveTimer = 0;
            this.sendLiveNow();
        }, kLiveSendIntervalMs);
    }

    async sendLiveNow()
    {
        const token = this.phaseToken;
        const image = await PixelImage.encode(this.drawPad.pixels, this.drawPad.size);
        if (token === this.phaseToken) this.sendAction({ t: 'live', image });
    }

    // ---- 伝言の結果と最後の順位 ----
    showChain(phase)
    {
        const list = this.byId('chainEntries');
        list.replaceChildren();
        for (const entry of Array.isArray(phase.entries) ? phase.entries : []) list.appendChild(this.createChainItem(entry, Number(phase.size)));
        const isLast = Number(phase.index) + 1 >= Number(phase.total);
        const button = this.byId('btnChainNext');
        button.hidden = !this.isHost;
        button.textContent = isLast ? '結果を閉じる' : `次へ（${Number(phase.index) + 1} / ${Number(phase.total)}）`;
        this.byId('phaseMessage').textContent = this.isHost ? '「次へ」で次の伝言を見せます' : 'ホストが次へ進めます';
    }

    createChainItem(entry, size)
    {
        const item = document.createElement('li');
        const name = document.createElement('div');
        name.className = 'chain-name';
        const verb = entry.kind === 'image' ? 'が描いた絵' : 'の言葉';
        name.textContent = `${String(entry.name)} さん${verb}` + (entry.isSkipped ? '（時間切れ・抜けたので代わり）' : '');
        item.appendChild(name);
        if (entry.kind === 'image') {
            const canvas = PixelImageView.createCanvas('pixel-image');
            item.appendChild(canvas);
            this.drawImage(canvas, entry.value, size);
        } else {
            const text = document.createElement('div');
            text.className = 'chain-text';
            text.textContent = String(entry.value);
            item.appendChild(text);
        }
        return item;
    }

    showFinal(phase)
    {
        const list = this.byId('finalRanking');
        list.replaceChildren();
        const ranking = Array.isArray(phase.ranking) ? phase.ranking : [];
        for (const row of ranking) {
            const item = document.createElement('li');
            item.textContent = `${String(row.name)}　${Number(row.score)} 点`;
            list.appendChild(item);
        }
        this.byId('btnToLobby').hidden = !this.isHost;
        this.byId('phaseMessage').textContent = ranking.length === 0 ? 'おつかれさまでした！' : '結果発表';
        if (!this.isHost) this.byId('phaseMessage').textContent += '（ホストが待合室に戻すのを待っています）';
    }
}
