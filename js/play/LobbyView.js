'use strict';

// 設定欄の id と、設定の項目名の対応（数値の項目）
const kNumberSettingFields = Object.freeze({
    setDrawSeconds: 'drawSeconds',
    setRevealSeconds: 'revealSeconds',
    setRounds: 'rounds',
});

// 待合室の画面。参加者の一覧、ホストの招待欄と設定欄。設定を変えられるのはホストだけ
class LobbyView
{
    // handlers: onSettingsChange(settings), onStart(), onCreateInvite(), onAcceptReply(code)
    constructor(isHost, myId, handlers)
    {
        this.isHost = isHost;
        this.myId = myId;
        this.handlers = handlers;
        this.byId('invitePanel').hidden = !isHost;
        this.byId('btnStart').hidden = !isHost;
        this.byId('settingsFields').disabled = !isHost;
        if (isHost) this.bindHostEvents();
    }

    byId(id)
    {
        return document.getElementById(id);
    }

    bindHostEvents()
    {
        this.byId('settingsFields').addEventListener('change', () => this.handlers.onSettingsChange(this.readSettings()));
        this.byId('btnStart').addEventListener('click', () => this.handlers.onStart());
        this.byId('btnCreateInvite').addEventListener('click', () => this.handlers.onCreateInvite());
        this.byId('btnCopyInvite').addEventListener('click', () => LobbyView.copyText(this.byId('inviteCodeOutput')));
        this.byId('btnAcceptReply').addEventListener('click', () => this.handlers.onAcceptReply(this.byId('replyCodeInput').value));
    }

    readSettings()
    {
        const checked = document.querySelector('input[name="mode"]:checked');
        const settings = {
            mode: checked === null ? GameMode.GuessDraw : checked.value,
            quizOrder: this.byId('setQuizOrder').value,
            size: Number(this.byId('setSize').value),
        };
        for (const [fieldId, key] of Object.entries(kNumberSettingFields)) settings[key] = Number(this.byId(fieldId).value);
        return settings;
    }

    render(lobby)
    {
        this.renderPlayers(lobby);
        this.renderSettings(lobby.settings);
        const canStart = lobby.players.length >= kMinPlayersToStart;
        this.byId('btnStart').disabled = !canStart;
        this.byId('lobbyNote').textContent = this.isHost
            ? (canStart ? '' : '2人以上になると始められます')
            : 'ホストが始めるのを待っています';
    }

    renderPlayers(lobby)
    {
        this.byId('playerCount').textContent = `（${lobby.players.length} / ${kMaxPlayers} 人）`;
        const list = this.byId('lobbyPlayers');
        list.replaceChildren();
        for (const player of lobby.players) {
            const item = document.createElement('li');
            const marks = [player.id === lobby.hostId ? 'ホスト' : '', player.id === this.myId ? 'あなた' : ''].filter(Boolean);
            item.textContent = player.name + (marks.length > 0 ? `（${marks.join('・')}）` : '');
            list.appendChild(item);
        }
    }

    renderSettings(settings)
    {
        for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === settings.mode;
        this.byId('setQuizOrder').value = settings.quizOrder;
        this.byId('setSize').value = String(settings.size);
        for (const [fieldId, key] of Object.entries(kNumberSettingFields)) this.byId(fieldId).value = String(settings[key]);
        const isQuiz = settings.mode === GameMode.RevealQuiz;
        this.byId('rowQuizOrder').hidden = !isQuiz;
        this.byId('rowRevealSeconds').hidden = !isQuiz;
        // 伝言お絵かきは人数ぶん回すので回数はない
        this.byId('rowRounds').hidden = settings.mode === GameMode.Relay;
        const isHostOnly = isQuiz && settings.quizOrder === QuizOrder.HostOnly;
        this.byId('roundsLabel').textContent = isHostOnly ? '問題の数' : '1人が出題する回数';
    }

    setInviteCode(code)
    {
        this.byId('inviteCodeOutput').value = code;
        this.byId('replyCodeInput').value = '';
    }

    setInviteError(text)
    {
        this.byId('inviteError').textContent = text;
    }

    setInviteStatus(text)
    {
        this.byId('inviteStatus').textContent = text;
    }

    setInviteBusy(isBusy)
    {
        this.byId('btnCreateInvite').disabled = isBusy;
        this.byId('btnAcceptReply').disabled = isBusy;
    }

    static async copyText(textarea)
    {
        if (textarea.value === '') return;
        try {
            await navigator.clipboard.writeText(textarea.value);
        } catch (error) {
            // クリップボードが使えない環境では、選択して Ctrl+C してもらう
            textarea.select();
        }
    }
}
