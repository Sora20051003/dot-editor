'use strict';

const GameMode = Object.freeze({ RevealQuiz: 'quiz', Relay: 'relay', GuessDraw: 'guess' });
const QuizOrder = Object.freeze({ Rotate: 'rotate', HostOnly: 'host' });
const RoomState = Object.freeze({ Lobby: 'lobby', Playing: 'playing', Finished: 'finished' });

const kMinPlayersToStart = 2;
// 設定の範囲 [最小, 最大, 最初の値]
const kSettingRanges = Object.freeze({
    drawSeconds: [20, 300, 90],
    revealSeconds: [3, 20, 6],
    rounds: [1, 10, 1],
});

// ホストだけが持つ「部屋」。参加者・設定・点数を持ち、ゲームの進行役（各モードのクラス）に手を貸す。
// 参加者の画面はここから届くメッセージだけを見て表示を変える
class GameRoom
{
    constructor(session, hostName)
    {
        this.session = session;
        this.players = new Map();
        this.settings = GameRoom.createDefaultSettings();
        this.state = RoomState.Lobby;
        this.participantIds = [];
        this.game = null;
        this.addPlayer(kHostPlayerId, hostName);
    }

    static createDefaultSettings()
    {
        const settings = { mode: GameMode.GuessDraw, quizOrder: QuizOrder.Rotate, size: 32 };
        for (const [key, range] of Object.entries(kSettingRanges)) settings[key] = range[2];
        return settings;
    }

    // ---- 参加者 ----
    addPlayer(id, name)
    {
        this.players.set(id, { id, name, score: 0, isConnected: true });
        this.broadcastLobby();
        if (this.state !== RoomState.Lobby) this.send(id, { t: 'phase', panel: 'wait', title: 'ゲーム中です', message: '次のゲームから参加できます' });
    }

    removePlayer(id)
    {
        const player = this.players.get(id);
        if (player === undefined) return;
        player.isConnected = false;
        if (this.state === RoomState.Lobby) this.players.delete(id);
        if (this.game !== null && this.participantIds.includes(id)) this.game.onLeave(id);
        this.broadcastLobby();
        if (this.state !== RoomState.Lobby) this.sendScores();
    }

    nameOf(id)
    {
        const player = this.players.get(id);
        return player === undefined ? '？' : player.name;
    }

    isConnected(id)
    {
        const player = this.players.get(id);
        return player !== undefined && player.isConnected;
    }

    connectedIds()
    {
        return [...this.players.values()].filter((p) => p.isConnected).map((p) => p.id);
    }

    addScore(id, points)
    {
        const player = this.players.get(id);
        if (player !== undefined) player.score += points;
    }

    // ---- 送信 ----
    send(id, message)
    {
        this.session.sendTo(id, message);
    }

    broadcast(message)
    {
        this.session.broadcast(message);
    }

    sendPhase(id, phase)
    {
        this.send(id, { t: 'phase', ...phase });
    }

    // ゲームの参加者（途中から入った人は除く）のうち、つながっている人に送る
    sendPhaseToParticipants(phase, exceptId = null)
    {
        for (const id of this.participantIds) {
            if (id !== exceptId && this.isConnected(id)) this.sendPhase(id, phase);
        }
    }

    broadcastLobby()
    {
        const players = [...this.players.values()].filter((p) => p.isConnected).map(({ id, name }) => ({ id, name }));
        this.broadcast({
            t: 'lobby', players, settings: this.settings, hostId: kHostPlayerId,
            isPlaying: this.state !== RoomState.Lobby, participantIds: this.participantIds,
        });
    }

    sendScores()
    {
        const players = this.participantIds.map((id) => {
            const player = this.players.get(id);
            const status = this.game !== null && player.isConnected ? this.game.statusOf(id) : '';
            return { id, name: player.name, score: player.score, status, isConnected: player.isConnected };
        });
        this.broadcast({ t: 'scores', players });
    }

    // ---- 操作の受け付け ----
    onAction(id, action)
    {
        if (typeof action.t !== 'string' || !this.players.has(id)) return;
        if (id === kHostPlayerId && this.handleHostAction(action)) return;
        if (this.game !== null && this.participantIds.includes(id)) this.game.onAction(id, action);
    }

    // 部屋の設定・開始・待合室に戻るはホストだけができる
    handleHostAction(action)
    {
        if (action.t === 'settings' && this.state === RoomState.Lobby) {
            this.applySettings(action.settings);
            return true;
        }
        if (action.t === 'start' && this.state === RoomState.Lobby) {
            this.startGame();
            return true;
        }
        if (action.t === 'toLobby' && this.state === RoomState.Finished) {
            this.backToLobby();
            return true;
        }
        return false;
    }

    applySettings(input)
    {
        if (input === null || typeof input !== 'object') return;
        const settings = { ...this.settings };
        if (Object.values(GameMode).includes(input.mode)) settings.mode = input.mode;
        if (Object.values(QuizOrder).includes(input.quizOrder)) settings.quizOrder = input.quizOrder;
        if (PixelImage.isValidSize(Number(input.size))) settings.size = Number(input.size);
        for (const [key, [min, max]] of Object.entries(kSettingRanges)) {
            const value = Math.round(Number(input[key]));
            if (Number.isFinite(value)) settings[key] = Math.min(max, Math.max(min, value));
        }
        this.settings = settings;
        this.broadcastLobby();
    }

    get canStart()
    {
        return this.connectedIds().length >= kMinPlayersToStart;
    }

    // ---- ゲームの開始と終わり ----
    startGame()
    {
        if (!this.canStart) return;
        this.participantIds = this.connectedIds();
        for (const player of this.players.values()) player.score = 0;
        this.state = RoomState.Playing;
        this.game = this.createGame();
        this.broadcastLobby();
        this.sendScores();
        this.game.start();
    }

    createGame()
    {
        switch (this.settings.mode) {
            case GameMode.RevealQuiz:
                return new RevealQuizGame(this, this.settings);
            case GameMode.Relay:
                return new RelayDrawGame(this, this.settings);
            default:
                return new GuessDrawGame(this, this.settings);
        }
    }

    // 各モードが最後に呼ぶ。hasRanking が false（伝言お絵かき）なら順位は出さない
    finishGame(hasRanking)
    {
        this.state = RoomState.Finished;
        if (this.game !== null) this.game.dispose();
        this.game = null;
        const ranking = hasRanking ? this.buildRanking() : null;
        this.broadcast({ t: 'phase', panel: 'final', title: 'おしまい', ranking });
    }

    buildRanking()
    {
        return this.participantIds
            .map((id) => ({ name: this.nameOf(id), score: this.players.get(id).score }))
            .sort((a, b) => b.score - a.score);
    }

    backToLobby()
    {
        for (const [id, player] of this.players) {
            if (!player.isConnected) this.players.delete(id);
        }
        this.state = RoomState.Lobby;
        this.participantIds = [];
        this.broadcastLobby();
    }
}
