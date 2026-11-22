'use strict';

// 1段細かくなるごとに減る点。1×1 で当てると段の数×この点
const kPointsPerRevealStep = 100;

// だんだんクイズ：出題者が描いた絵を、1×1 → 2×2 → … と少しずつ細かくして見せ、早く当てた人ほど高得点。
// 当てる人には細かくした絵しか送らない（元の絵を先に受け取れないように）
class RevealQuizGame extends PresenterGame
{
    constructor(room, settings)
    {
        const queue = settings.quizOrder === QuizOrder.HostOnly
            ? new Array(settings.rounds).fill(kHostPlayerId)
            : PresenterGame.rotateQueue(room, settings.rounds);
        super(room, settings, queue);
        this.steps = PixelImage.revealSteps(settings.size);
        this.stepImages = [];
        this.stepIndex = 0;
    }

    beginDrawing()
    {
        this.phase = PresenterPhase.Draw;
        const remainingMs = this.settings.drawSeconds * kMsPerSecond;
        this.room.sendPhase(this.presenterId, {
            panel: 'draw', title: 'お題を描いてください', prompt: this.answer,
            size: this.settings.size, remainingMs, isLive: false,
        });
        this.room.sendPhaseToParticipants(
            { panel: 'wait', title: '絵を描いています', message: `${this.presenterName} さんが描いています` }, this.presenterId);
        // 時間切れで絵が届かなければ白紙で進める
        this.timer.start(remainingMs + kNetworkGraceMs, () => this.prepareReveal(PixelImage.createBlank(this.settings.size)));
        this.room.sendScores();
    }

    async onDrawingAction(action)
    {
        if (this.phase !== PresenterPhase.Draw || action.t !== 'drawing') return;
        const token = this.roundToken;
        const pixels = await PixelImage.decode(action.image, this.settings.size);
        if (pixels === null || token !== this.roundToken || this.phase !== PresenterPhase.Draw) return;
        this.prepareReveal(pixels);
    }

    // すべての細かさの絵を先に作っておく（見せるたびに作ると遅れるため）
    async prepareReveal(pixels)
    {
        this.phase = PresenterPhase.Prepare;
        this.timer.cancel();
        const token = this.roundToken;
        const size = this.settings.size;
        this.stepImages = await Promise.all(this.steps.map((cells) => {
            const stepPixels = cells === size ? pixels : PixelImage.mosaic(pixels, size, cells);
            return PixelImage.encode(stepPixels, size);
        }));
        if (token !== this.roundToken) return;
        this.beginReveal();
    }

    beginReveal()
    {
        this.startGuessing(() => (this.steps.length - this.stepIndex) * kPointsPerRevealStep);
        this.room.sendPhase(this.presenterId, {
            panel: 'view', title: 'みんなが当てています', message: `お題：${this.answer}`,
            image: this.answerImage(), size: this.settings.size,
        });
        this.room.sendScores();
        if (this.board.isAllSolved) {
            this.showAnswer();
            return;
        }
        this.showStep(0);
    }

    showStep(index)
    {
        this.stepIndex = index;
        const cells = this.steps[index];
        const remainingMs = this.settings.revealSeconds * kMsPerSecond;
        for (const id of this.guesserIds) {
            this.room.sendPhase(id, {
                panel: 'view', title: '何の絵でしょう？', message: `${cells}×${cells} マス（${this.currentPointsText()}）`,
                image: this.stepImages[index], size: this.settings.size, remainingMs, canGuess: this.board.canGuess(id),
            });
        }
        const isLast = index + 1 >= this.steps.length;
        this.timer.start(remainingMs, () => (isLast ? this.showAnswer() : this.showStep(index + 1)));
    }

    currentPointsText()
    {
        return `今当てると ${(this.steps.length - this.stepIndex) * kPointsPerRevealStep} 点`;
    }

    answerImage()
    {
        return this.stepImages.length > 0 ? this.stepImages[this.stepImages.length - 1] : null;
    }

    nextRound()
    {
        this.stepImages = [];
        super.nextRound();
    }
}
