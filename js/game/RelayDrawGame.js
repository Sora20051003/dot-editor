'use strict';

const kRelayTextSeconds = 40;
const RelayKind = Object.freeze({ Text: 'text', Image: 'image' });

// 伝言お絵かき：全員が同時に進む。最初にお題を書き、次の人が絵にし、次の人がその絵を言葉にし…を人数ぶん回す。
// 人数ぶんの「伝言の列（chain）」があり、1段ごとに1人ずつずれて担当する。最後に列を1つずつ見せる
class RelayDrawGame
{
    constructor(room, settings)
    {
        this.room = room;
        this.settings = settings;
        this.order = [...room.participantIds];
        this.chains = this.order.map(() => []);
        this.step = -1;
        this.submittedIds = new Set();
        this.timer = new OneShotTimer();
        this.stepToken = 0;
        this.isRevealing = false;
        this.revealIndex = 0;
        this.blankImage = null;
    }

    async start()
    {
        // 抜けた人の絵の代わりに使う白紙。毎回作らないよう最初に1枚だけ作る
        this.blankImage = await PixelImage.encode(PixelImage.createBlank(this.settings.size), this.settings.size);
        this.nextStep();
    }

    get playerCount()
    {
        return this.order.length;
    }

    kindOf(step)
    {
        return step % 2 === 0 ? RelayKind.Text : RelayKind.Image;
    }

    // 段 step で、i 番目の人が担当する列。1段ごとに1つ前の人の列へずれる
    chainIndexFor(playerIndex, step)
    {
        const n = this.playerCount;
        return (((playerIndex - step) % n) + n) % n;
    }

    nextStep()
    {
        this.stepToken++;
        this.step++;
        if (this.step >= this.playerCount) {
            this.beginReveal();
            return;
        }
        this.submittedIds.clear();
        const stepMs = this.stepSeconds() * kMsPerSecond;
        this.order.forEach((id, index) => {
            if (this.room.isConnected(id)) {
                this.sendStepPhase(id, index, stepMs);
            } else {
                this.fillSkipped(index);
            }
        });
        this.room.sendScores();
        this.timer.start(stepMs + kNetworkGraceMs, () => this.fillMissing());
        this.advanceIfDone();
    }

    stepSeconds()
    {
        return this.kindOf(this.step) === RelayKind.Text ? kRelayTextSeconds : this.settings.drawSeconds;
    }

    previousEntry(playerIndex)
    {
        return this.chains[this.chainIndexFor(playerIndex, this.step)][this.step - 1];
    }

    sendStepPhase(id, playerIndex, remainingMs)
    {
        if (this.step === 0) {
            this.room.sendPhase(id, {
                panel: 'prompt', title: '最初のお題を書いてください', message: '次の人がこれを絵にします。下の候補から選んでもOK',
                choices: PromptList.pickRandom(kPromptChoiceCount), remainingMs, maxLength: kMaxPromptLength,
            });
            return;
        }
        const previous = this.previousEntry(playerIndex);
        if (this.kindOf(this.step) === RelayKind.Image) {
            this.room.sendPhase(id, {
                panel: 'draw', title: 'この言葉を絵にしてください', prompt: previous.value,
                size: this.settings.size, remainingMs, isLive: false,
            });
            return;
        }
        this.room.sendPhase(id, {
            panel: 'view', title: 'この絵は何？', message: '見えたものを言葉で書いてください',
            image: previous.value, size: this.settings.size, remainingMs, canAnswerOnce: true, maxLength: kMaxPromptLength,
        });
    }

    async onAction(id, action)
    {
        if (this.isRevealing) {
            if (action.t === 'next' && id === kHostPlayerId) this.showNextChain();
            return;
        }
        const index = this.order.indexOf(id);
        if (index < 0 || this.submittedIds.has(id)) return;
        if (this.kindOf(this.step) === RelayKind.Text && action.t === 'text') {
            const text = AnswerChecker.cleanText(action.text, kMaxPromptLength);
            if (text !== '') this.submit(index, text);
            return;
        }
        if (this.kindOf(this.step) === RelayKind.Image && action.t === 'drawing') {
            const token = this.stepToken;
            const pixels = await PixelImage.decode(action.image, this.settings.size);
            if (pixels === null || token !== this.stepToken || this.submittedIds.has(id)) return;
            this.submit(index, { size: action.image.size, data: action.image.data });
        }
    }

    submit(playerIndex, value)
    {
        this.store(playerIndex, value, false);
        const id = this.order[playerIndex];
        this.room.sendPhase(id, { panel: 'wait', title: '提出しました', message: 'みんなが終わるのを待っています' });
        this.room.sendScores();
        this.advanceIfDone();
    }

    store(playerIndex, value, isSkipped)
    {
        const id = this.order[playerIndex];
        const chain = this.chains[this.chainIndexFor(playerIndex, this.step)];
        chain[this.step] = { name: this.room.nameOf(id), kind: this.kindOf(this.step), value, isSkipped };
        this.submittedIds.add(id);
    }

    // 間に合わなかった・抜けた人のぶん。列が途切れないよう、2段前（同じ種類）をそのまま引き継ぐ
    fillSkipped(playerIndex)
    {
        if (this.submittedIds.has(this.order[playerIndex])) return;
        const chain = this.chains[this.chainIndexFor(playerIndex, this.step)];
        let value;
        if (this.step === 0) {
            value = PromptList.pickRandom(1)[0];
        } else if (this.step >= 2) {
            value = chain[this.step - 2].value;
        } else {
            value = this.blankImage;
        }
        this.store(playerIndex, value, true);
    }

    fillMissing()
    {
        this.order.forEach((id, index) => this.fillSkipped(index));
        this.advanceIfDone();
    }

    advanceIfDone()
    {
        if (this.isRevealing || this.submittedIds.size < this.playerCount) return;
        this.timer.cancel();
        this.nextStep();
    }

    onLeave(id)
    {
        if (this.isRevealing) return;
        const index = this.order.indexOf(id);
        if (index < 0) return;
        this.fillSkipped(index);
        this.advanceIfDone();
    }

    beginReveal()
    {
        this.isRevealing = true;
        this.revealIndex = -1;
        this.showNextChain();
    }

    // ホストが「次へ」を押すたびに1列ずつ見せる
    showNextChain()
    {
        this.revealIndex++;
        if (this.revealIndex >= this.playerCount) {
            this.room.finishGame(false);
            return;
        }
        const starter = this.room.nameOf(this.order[this.revealIndex]);
        this.room.sendPhaseToParticipants({
            panel: 'chain', title: `${starter} さんのお題から`, entries: this.chains[this.revealIndex],
            size: this.settings.size, index: this.revealIndex, total: this.playerCount,
        });
        this.room.sendScores();
    }

    statusOf(id)
    {
        if (this.isRevealing) return '';
        return this.submittedIds.has(id) ? '提出済み' : '考え中';
    }

    dispose()
    {
        this.stepToken++;
        this.timer.cancel();
    }
}
