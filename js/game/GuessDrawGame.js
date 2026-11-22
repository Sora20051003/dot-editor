'use strict';

// 当てたときの点 = 基本点 + 残り時間の割合 × 早さの点
const kGuessBasePoints = 50;
const kGuessSpeedPoints = 150;

// お題当て：描く人にだけお題を見せ、描いている途中の絵を他の人へ流す。他の人は答えを打ち込んで当てる
class GuessDrawGame extends PresenterGame
{
    constructor(room, settings)
    {
        super(room, settings, PresenterGame.rotateQueue(room, settings.rounds));
        this.latestImage = null;
        // 届いた順と読み終わった順が入れ替わっても、古い絵で上書きしないための番号
        this.liveSequence = 0;
        this.appliedSequence = 0;
        this.drawMs = 0;
    }

    beginDrawing()
    {
        this.latestImage = null;
        this.drawMs = this.settings.drawSeconds * kMsPerSecond;
        this.startGuessing(() => this.currentPoints());
        this.room.sendPhase(this.presenterId, {
            panel: 'draw', title: 'お題を描いてください（描いている途中も見えています）', prompt: this.answer,
            size: this.settings.size, remainingMs: this.drawMs, isLive: true,
        });
        const hint = `${[...this.answer].length} 文字`;
        for (const id of this.guesserIds) {
            this.room.sendPhase(id, {
                panel: 'view', title: `${this.presenterName} さんは何を描いている？`, message: hint,
                image: null, size: this.settings.size, remainingMs: this.drawMs, canGuess: true,
            });
        }
        this.room.sendScores();
        if (this.board.isAllSolved) {
            this.showAnswer();
            return;
        }
        this.timer.start(this.drawMs, () => this.showAnswer());
    }

    currentPoints()
    {
        const remainingRatio = this.drawMs > 0 ? this.timer.remainingMs / this.drawMs : 0;
        return kGuessBasePoints + Math.round(kGuessSpeedPoints * remainingRatio);
    }

    // 届いた絵が正しい形か確かめてから、当てる人に流す
    async onDrawingAction(action)
    {
        if (this.phase !== PresenterPhase.Guess) return;
        const sequence = ++this.liveSequence;
        const token = this.roundToken;
        const pixels = await PixelImage.decode(action.image, this.settings.size);
        if (pixels === null || token !== this.roundToken || sequence < this.appliedSequence) return;
        if (this.phase !== PresenterPhase.Guess) return;
        this.appliedSequence = sequence;
        // 余計な中身を他の人へ流さないよう、確かめた2つだけで作り直す
        this.latestImage = { size: action.image.size, data: action.image.data };
        for (const id of this.guesserIds) this.room.send(id, { t: 'image', image: this.latestImage });
    }

    answerImage()
    {
        return this.latestImage;
    }
}
