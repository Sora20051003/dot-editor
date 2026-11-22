'use strict';

const PresenterPhase = Object.freeze({
    Choose: 'choose',
    Draw: 'draw',
    Prepare: 'prepare',
    Guess: 'guess',
    Answer: 'answer',
});

// 「1人が出題して、他の人が当てる」ゲームの共通の流れ（だんだんクイズとお題当て）。
// 出題者の順番 → お題を選ぶ → （各モードの描く・見せる） → 答えを見せる → 次の出題者
// 各モードは beginDrawing / onDrawingAction / answerImage を持つ
class PresenterGame
{
    constructor(room, settings, presenterQueue)
    {
        this.room = room;
        this.settings = settings;
        this.presenterQueue = presenterQueue;
        this.presenterId = null;
        this.phase = PresenterPhase.Answer;
        this.answer = '';
        this.chooser = null;
        this.board = null;
        this.timer = new OneShotTimer();
        // 非同期の処理（絵の圧縮など）が終わったとき、もう次の問題に進んでいないか確かめる番号
        this.roundToken = 0;
    }

    // 全員が rounds 回ずつ出題する順番
    static rotateQueue(room, rounds)
    {
        const queue = [];
        for (let i = 0; i < rounds; i++) queue.push(...room.participantIds);
        return queue;
    }

    start()
    {
        this.nextRound();
    }

    nextRound()
    {
        this.roundToken++;
        this.board = null;
        while (this.presenterQueue.length > 0) {
            const id = this.presenterQueue.shift();
            if (this.room.isConnected(id)) {
                this.beginRound(id);
                return;
            }
        }
        this.room.finishGame(true);
    }

    beginRound(presenterId)
    {
        this.presenterId = presenterId;
        this.phase = PresenterPhase.Choose;
        this.chooser = new PromptChooser(this.room, presenterId, (text) => {
            this.answer = text;
            this.beginDrawing();
        });
        this.chooser.begin();
        this.room.sendScores();
    }

    get presenterName()
    {
        return this.room.nameOf(this.presenterId);
    }

    get guesserIds()
    {
        return this.room.participantIds.filter((id) => id !== this.presenterId && this.room.isConnected(id));
    }

    startGuessing(pointsNow)
    {
        this.phase = PresenterPhase.Guess;
        this.board = new GuessBoard(this.room, this.answer, this.presenterId, this.guesserIds, pointsNow, () => this.showAnswer());
    }

    showAnswer()
    {
        if (this.phase === PresenterPhase.Answer) return;
        this.phase = PresenterPhase.Answer;
        this.room.sendPhaseToParticipants({
            panel: 'view', title: `答えは「${this.answer}」`, message: `${this.presenterName} さんの絵`,
            image: this.answerImage(), size: this.settings.size,
        });
        this.room.sendScores();
        this.timer.start(kAnswerShowMs, () => this.nextRound());
    }

    // 出題者が抜けたら、その問題は飛ばす
    skipRound()
    {
        this.roundToken++;
        if (this.chooser !== null) this.chooser.cancel();
        this.phase = PresenterPhase.Answer;
        this.room.sendPhaseToParticipants({ panel: 'wait', title: '出題者が抜けました', message: '次の問題に進みます' });
        this.timer.start(kAnswerShowMs, () => this.nextRound());
    }

    onAction(id, action)
    {
        switch (action.t) {
            case 'text':
                if (this.phase === PresenterPhase.Choose) this.chooser.submit(id, action.text);
                break;
            case 'drawing':
            case 'live':
                if (id === this.presenterId) this.onDrawingAction(action);
                break;
            case 'answer':
                if (this.phase === PresenterPhase.Guess) this.board.submit(id, action.text);
                break;
            case 'markCorrect':
                if (this.phase === PresenterPhase.Guess) this.board.markCorrect(id, Number(action.guessId));
                break;
        }
    }

    onLeave(id)
    {
        const isBeforeGuessing = this.phase !== PresenterPhase.Guess && this.phase !== PresenterPhase.Answer;
        if (id === this.presenterId && isBeforeGuessing) {
            this.skipRound();
            return;
        }
        if (this.phase === PresenterPhase.Guess && this.board.isAllSolved) this.showAnswer();
    }

    statusOf(id)
    {
        if (id === this.presenterId) return this.phase === PresenterPhase.Choose ? 'お題を選んでいる' : '出題中';
        if (this.board !== null && this.board.solvedIds.has(id)) return '正解！';
        return '';
    }

    dispose()
    {
        this.roundToken++;
        this.timer.cancel();
        if (this.chooser !== null) this.chooser.cancel();
    }
}
