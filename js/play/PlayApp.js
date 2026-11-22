'use strict';

const kPlayerNameStorageKey = 'dotEditor.playerName';
const kScreenIds = Object.freeze(['screenStart', 'screenJoin', 'screenLobby', 'screenGame']);

// 通信モードの組み立て。ホストなら HostSession と GameRoom を作り、参加者なら GuestSession を作る。
// どちらも画面はホストから届くメッセージ（onEvent）だけで切り替える
class PlayApp
{
    constructor()
    {
        this.name = '';
        this.isHost = false;
        this.myId = null;
        this.hostSession = null;
        this.guestSession = null;
        this.room = null;
        this.lobbyView = null;
        this.gameScreen = null;
        this.lobby = null;
        this.isConnected = false;
        this.byId('nameInput').value = PlayApp.loadName();
        this.byId('btnHost').addEventListener('click', () => this.startHost());
        this.byId('btnJoin').addEventListener('click', () => this.startJoin());
        // 閉じるとホストなら部屋ごと、参加者なら自分が抜けてしまうので確かめる
        window.addEventListener('beforeunload', (e) => {
            if (this.isConnected) e.preventDefault();
        });
        // exe 版（desktop/）は窓を閉じるときにこれを呼んで確かめる（beforeunload が出ないため）
        window.dotAppUnsavedMessage = () => (this.isConnected ? 'ほかの人とつながっています。閉じるとつながりが切れます。' : '');
    }

    byId(id)
    {
        return document.getElementById(id);
    }

    showScreen(id)
    {
        for (const screenId of kScreenIds) this.byId(screenId).hidden = screenId !== id;
    }

    setStatus(text)
    {
        this.byId('connectionStatus').textContent = text;
    }

    // 名前を決めてから始める。前回の名前は覚えておく
    takeName()
    {
        const name = HostSession.cleanName(this.byId('nameInput').value);
        try {
            localStorage.setItem(kPlayerNameStorageKey, name);
        } catch (error) {
            // 保存できなくても遊べるので無視する
        }
        this.name = name;
        this.byId('myName').textContent = `名前：${name}`;
        return name;
    }

    static loadName()
    {
        try {
            return localStorage.getItem(kPlayerNameStorageKey) || '';
        } catch (error) {
            return '';
        }
    }

    createViews(sendAction)
    {
        this.gameScreen = new GameScreen(sendAction, this.isHost);
        this.lobbyView = new LobbyView(this.isHost, this.myId, {
            onSettingsChange: (settings) => sendAction({ t: 'settings', settings }),
            onStart: () => sendAction({ t: 'start' }),
            onCreateInvite: () => this.createInvite(),
            onAcceptReply: (code) => this.acceptReply(code),
        });
    }

    // ---- ホスト ----
    startHost()
    {
        if (this.hostSession !== null || this.guestSession !== null) return;
        this.takeName();
        this.isHost = true;
        this.myId = kHostPlayerId;
        this.isConnected = true;
        this.hostSession = new HostSession({
            onJoin: (id, name) => {
                this.room.addPlayer(id, name);
                this.lobbyView.setInviteStatus(`${name} さんが入りました`);
            },
            onLeave: (id) => this.room.removePlayer(id),
            onAction: (id, message) => this.room.onAction(id, message),
            onLocalEvent: (message) => this.onEvent(message),
            onStatus: (text) => this.lobbyView.setInviteStatus(text),
        });
        this.createViews((message) => this.hostSession.sendFromLocal(message));
        this.room = new GameRoom(this.hostSession, this.name);
        this.setStatus('ホスト');
    }

    async createInvite()
    {
        this.lobbyView.setInviteError('');
        this.lobbyView.setInviteBusy(true);
        this.lobbyView.setInviteStatus('招待コードを作っています…（数秒かかります）');
        try {
            this.lobbyView.setInviteCode(await this.hostSession.createInvite());
            this.lobbyView.setInviteStatus('コピーして、入る人に送ってください');
        } catch (error) {
            this.lobbyView.setInviteError(error.message);
            this.lobbyView.setInviteStatus('');
        }
        this.lobbyView.setInviteBusy(false);
    }

    async acceptReply(code)
    {
        this.lobbyView.setInviteError('');
        try {
            await this.hostSession.acceptReply(code);
            this.lobbyView.setInviteStatus('つないでいます…');
            this.lobbyView.setInviteCode('');
        } catch (error) {
            this.lobbyView.setInviteError(error.message);
        }
    }

    // ---- 参加する人 ----
    startJoin()
    {
        if (this.hostSession !== null || this.guestSession !== null) return;
        this.takeName();
        this.guestSession = new GuestSession(this.name, {
            onEvent: (message) => this.onEvent(message),
            onOpen: () => {
                this.isConnected = true;
                this.byId('joinStatus').textContent = 'つながりました。待合室に入っています…';
                this.setStatus('接続中');
            },
            onClose: () => this.onGuestClosed(),
        });
        this.byId('btnMakeReply').addEventListener('click', () => this.makeReply());
        this.byId('btnCopyReply').addEventListener('click', () => LobbyView.copyText(this.byId('replyCodeOutput')));
        this.showScreen('screenJoin');
    }

    async makeReply()
    {
        this.byId('joinError').textContent = '';
        this.byId('replyCodeOutput').value = '';
        this.byId('joinStatus').textContent = '返事コードを作っています…（数秒かかります）';
        try {
            this.byId('replyCodeOutput').value = await this.guestSession.createReply(this.byId('inviteCodeInput').value);
            this.byId('joinStatus').textContent = 'ホストが返事コードを貼ると、自動でつながります';
        } catch (error) {
            this.byId('joinError').textContent = error.message;
            this.byId('joinStatus').textContent = '';
        }
    }

    onGuestClosed()
    {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.setStatus('切断');
        const text = wasConnected
            ? 'ホストとのつながりが切れました。もう一度入るには、ページを読み込み直してください'
            : 'つながりませんでした。招待コードを作り直してもらってください';
        this.byId('statusMessage').textContent = text;
        this.byId('joinStatus').textContent = text;
    }

    // ---- ホストから届くメッセージ ----
    onEvent(message)
    {
        switch (message.t) {
            case 'welcome':
                this.myId = String(message.myId);
                this.createViews((action) => this.guestSession.send(action));
                break;
            case 'lobby':
                this.onLobby(message);
                break;
            case 'phase':
                this.showScreen('screenGame');
                this.gameScreen.showPhase(message);
                break;
            default:
                this.forwardToGame(message);
        }
    }

    forwardToGame(message)
    {
        if (this.gameScreen === null) return;
        const side = this.gameScreen.side;
        const actions = {
            scores: () => side.renderScores(Array.isArray(message.players) ? message.players : []),
            feed: () => side.addFeed(message.entry || {}),
            feedClear: () => side.clearFeed(),
            solved: () => side.onSolved(),
            image: () => this.gameScreen.onImage(message.image),
        };
        if (actions[message.t]) actions[message.t]();
    }

    onLobby(lobby)
    {
        if (this.lobbyView === null) return;
        this.lobby = lobby;
        this.lobbyView.render(lobby);
        this.gameScreen.setScoreVisible(lobby.settings.mode !== GameMode.Relay);
        if (!lobby.isPlaying) this.showScreen('screenLobby');
    }
}

new PlayApp();
