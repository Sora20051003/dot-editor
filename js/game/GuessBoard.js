'use strict';

// 1人が当てるたびに出題者にも入る点
const kPresenterBonusPoints = 50;

// 1問ぶんの回答の受け付けと点数。だんだんクイズとお題当てで共通。
// 文字が同じなら自動で正解。違う言い方は出題者が「正解にする」で後から正解にできる
class GuessBoard
{
    // pointsNow(): 今答えたら何点か。onAllSolved(): 全員が当てたとき
    constructor(room, answer, presenterId, guesserIds, pointsNow, onAllSolved)
    {
        this.room = room;
        this.answer = answer;
        this.presenterId = presenterId;
        this.guesserIds = new Set(guesserIds);
        this.pointsNow = pointsNow;
        this.onAllSolved = onAllSolved;
        this.solvedIds = new Set();
        this.guesses = new Map();
        this.nextGuessId = 1;
        room.broadcast({ t: 'feedClear' });
    }

    canGuess(playerId)
    {
        return this.guesserIds.has(playerId) && !this.solvedIds.has(playerId);
    }

    get isAllSolved()
    {
        for (const id of this.guesserIds) {
            if (this.room.isConnected(id) && !this.solvedIds.has(id)) return false;
        }
        return true;
    }

    submit(playerId, rawText)
    {
        const text = AnswerChecker.cleanText(rawText);
        if (text === '' || !this.canGuess(playerId)) return;
        const guess = { id: this.nextGuessId++, playerId, text, points: this.pointsNow() };
        if (AnswerChecker.isMatch(text, this.answer)) {
            this.award(guess);
            return;
        }
        this.guesses.set(guess.id, guess);
        this.sendWrongGuess(guess);
    }

    // 外れた答えは全員に見せる。出題者にだけ「正解にする」ボタンを出す
    sendWrongGuess(guess)
    {
        const name = this.room.nameOf(guess.playerId);
        for (const id of this.room.connectedIds()) {
            const canMark = id === this.presenterId;
            this.room.send(id, { t: 'feed', entry: { guessId: guess.id, name, text: guess.text, isCorrect: false, canMark } });
        }
    }

    // 出題者だけが使える。答えた時点の点数で正解にする
    markCorrect(byId, guessId)
    {
        if (byId !== this.presenterId) return;
        const guess = this.guesses.get(guessId);
        if (guess === undefined || !this.canGuess(guess.playerId)) return;
        this.award(guess);
    }

    // 正解の言葉は他の人に見えないよう、名前だけ知らせる
    award(guess)
    {
        this.solvedIds.add(guess.playerId);
        this.room.addScore(guess.playerId, guess.points);
        this.room.addScore(this.presenterId, kPresenterBonusPoints);
        const name = this.room.nameOf(guess.playerId);
        this.room.broadcast({ t: 'feed', entry: { name, text: null, isCorrect: true, points: guess.points } });
        this.room.send(guess.playerId, { t: 'solved' });
        this.room.sendScores();
        if (this.isAllSolved) this.onAllSolved();
    }
}
