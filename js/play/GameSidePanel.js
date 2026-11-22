'use strict';

// ゲーム中の右側：参加者と点数、回答の流れ、答えの入力欄
class GameSidePanel
{
    constructor(sendAction)
    {
        this.sendAction = sendAction;
        this.isScoreVisible = true;
        this.isSolved = false;
        this.answerInput = document.getElementById('answerInput');
        this.answerButton = document.getElementById('btnAnswer');
        this.answerButton.addEventListener('click', () => this.sendAnswer());
        this.answerInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) this.sendAnswer();
        });
        this.setAnswerEnabled(false);
    }

    sendAnswer()
    {
        const text = this.answerInput.value.trim();
        if (text === '' || this.answerInput.disabled) return;
        this.sendAction({ t: 'answer', text });
        this.answerInput.value = '';
    }

    // 当てる場面になったときだけ入力できるようにする。正解したあとは入力できない
    setAnswerEnabled(isEnabled)
    {
        const canType = isEnabled && !this.isSolved;
        this.answerInput.disabled = !canType;
        this.answerButton.disabled = !canType;
        this.answerInput.placeholder = this.isSolved ? '正解しました！' : (isEnabled ? '答えを入力して Enter' : '今は答えられません');
        if (canType) this.answerInput.focus();
    }

    onSolved()
    {
        this.isSolved = true;
        this.setAnswerEnabled(false);
    }

    clearFeed()
    {
        this.isSolved = false;
        document.getElementById('feedList').replaceChildren();
    }

    addFeed(entry)
    {
        const item = document.createElement('li');
        const name = typeof entry.name === 'string' ? entry.name : '？';
        if (entry.isCorrect) {
            item.className = 'is-correct';
            item.textContent = `${name} さんが正解！` + (Number.isFinite(entry.points) ? `（+${entry.points}）` : '');
        } else {
            item.textContent = `${name}：${String(entry.text)}`;
            if (entry.canMark) item.appendChild(this.createMarkButton(entry.guessId));
        }
        const list = document.getElementById('feedList');
        list.appendChild(item);
        list.scrollTop = list.scrollHeight;
    }

    createMarkButton(guessId)
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mark-button';
        button.textContent = '正解にする';
        button.addEventListener('click', () => {
            this.sendAction({ t: 'markCorrect', guessId });
            button.remove();
        });
        return button;
    }

    renderScores(players)
    {
        const list = document.getElementById('scoreList');
        list.replaceChildren();
        for (const player of players) {
            const item = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = player.name + (player.isConnected ? '' : '（抜けた）');
            const detail = document.createElement('span');
            detail.className = 'dim';
            const parts = [player.status, this.isScoreVisible ? `${player.score} 点` : ''].filter(Boolean);
            detail.textContent = parts.join('　');
            item.append(name, detail);
            list.appendChild(item);
        }
    }
}
