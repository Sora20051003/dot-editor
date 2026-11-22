'use strict';

const kChooseSeconds = 30;
const kPromptChoiceCount = 3;
const kMaxPromptLength = 20;
const kMsPerSecond = 1000;
// 相手の画面で時間切れになってから届くまでの待ち時間（通信の遅れのぶん）
const kNetworkGraceMs = 3000;
// 1問終わったあと、答えを見せておく時間
const kAnswerShowMs = 5000;

// 出題者がお題を決める場面。内蔵のお題から選ぶか、自分で入力する。
// 時間切れなら最初の候補にする。決まったお題は出題者にしか送らない
class PromptChooser
{
    constructor(room, presenterId, onChosen)
    {
        this.room = room;
        this.presenterId = presenterId;
        this.onChosen = onChosen;
        this.choices = PromptList.pickRandom(kPromptChoiceCount);
        this.timer = new OneShotTimer();
        this.isDone = false;
    }

    begin()
    {
        const remainingMs = kChooseSeconds * kMsPerSecond;
        this.room.sendPhase(this.presenterId, {
            panel: 'prompt', title: 'お題を選んでください', message: '選んだお題は、他の人には見えません',
            choices: this.choices, remainingMs, maxLength: kMaxPromptLength,
        });
        const name = this.room.nameOf(this.presenterId);
        for (const id of this.room.participantIds) {
            if (id !== this.presenterId) this.room.sendPhase(id, { panel: 'wait', title: 'お題を選んでいます', message: `${name} さんがお題を選んでいます` });
        }
        this.timer.start(remainingMs + kNetworkGraceMs, () => this.finish(this.choices[0]));
    }

    // 戻り値は「この操作を受け取ったか」
    submit(playerId, rawText)
    {
        if (this.isDone || playerId !== this.presenterId) return false;
        const text = AnswerChecker.cleanText(rawText, kMaxPromptLength);
        if (text === '') return false;
        this.finish(text);
        return true;
    }

    finish(text)
    {
        if (this.isDone) return;
        this.isDone = true;
        this.timer.cancel();
        this.onChosen(text);
    }

    cancel()
    {
        this.isDone = true;
        this.timer.cancel();
    }
}
