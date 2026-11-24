'use strict';

// 最初に読むアバター（公開版・exe 版。file:// では読めないので「絵を開く」から選んでもらう）
const kDefaultAvatarUrl = 'models/vtuber-avatar.dotart';
const kAvatarSettingsKey = 'dotAvatarSettings';
const kAvatarBackgrounds = Object.freeze(['green', 'blue', 'transparent', 'dark']);
const kDefaultAvatarBackground = 'green';
// 大きさの表示（対数）の下の端と上の端（RMS）
const kMeterMinLevel = 0.001;
const kMeterMaxLevel = 0.3;

// アバターの画面。マイク・まばたき・描く部品をつなぎ、画面のボタンと結ぶ
class AvatarApp
{
    constructor()
    {
        const byId = (id) => document.getElementById(id);
        this.el = {
            canvas: byId('avatarCanvas'),
            panel: byId('avatarPanel'),
            mic: byId('btnMic'),
            sensitivity: byId('voiceSensitivity'),
            meter: byId('voiceMeterBar'),
            threshold: byId('voiceMeterThreshold'),
            background: byId('avatarBackground'),
            open: byId('btnOpenAvatar'),
            fileInput: byId('avatarFileInput'),
            hide: byId('btnHideUi'),
            message: byId('avatarMessage'),
            showHint: byId('showUiHint'),
        };
        this.view = new AvatarView(this.el.canvas);
        this.mouth = new MouthByVoice();
        this.blinker = new Blinker();
        this.loadSettings();
        this.bindEvents();
        if (new URLSearchParams(location.search).has('hideui')) this.setUiHidden(true);
        this.loadDefaultModel();
        requestAnimationFrame((now) => this.tick(now));
    }

    bindEvents()
    {
        const el = this.el;
        el.mic.addEventListener('click', () => this.toggleMic());
        el.sensitivity.addEventListener('input', () => {
            this.mouth.sensitivity = Number(el.sensitivity.value);
            this.saveSettings();
        });
        el.background.addEventListener('change', () => {
            this.applyBackground(el.background.value);
            this.saveSettings();
        });
        el.open.addEventListener('click', () => el.fileInput.click());
        el.fileInput.addEventListener('change', () => {
            const file = el.fileInput.files[0];
            el.fileInput.value = '';
            if (file !== undefined) this.loadModel(file, file.name);
        });
        el.hide.addEventListener('click', () => this.setUiHidden(true));
        // 操作を隠したあとは、画面のどこかを押すか H で戻す
        el.canvas.addEventListener('click', () => this.setUiHidden(false));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'h' || e.key === 'H') this.setUiHidden(!document.body.classList.contains('is-ui-hidden'));
        });
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file !== undefined) this.loadModel(file, file.name);
        });
    }

    async loadDefaultModel()
    {
        if (location.protocol === 'file:') {
            this.showMessage('「絵を開く」から、アバターの作業ファイル（.dotart）を選んでください');
            return;
        }
        try {
            const response = await fetch(kDefaultAvatarUrl);
            if (!response.ok) throw new Error(`読み込めませんでした（${response.status}）`);
            await this.loadModel(await response.blob(), 'アバター');
        } catch (error) {
            this.showMessage(`最初のアバターを読めませんでした：${error.message}`);
        }
    }

    async loadModel(blob, label)
    {
        this.showMessage(`${label} を読んでいます…`);
        try {
            const model = await AvatarModel.fromBlob(blob);
            this.view.setModel(model);
            const missing = model.missingRoleNames;
            this.showMessage(missing.length === 0
                ? `${label} を読みました`
                : `${label} を読みました。動きに使うレイヤーが見つかりません：${missing.join('・')}`);
        } catch (error) {
            this.showMessage(`開けませんでした：${error.message}`);
        }
    }

    async toggleMic()
    {
        if (this.mouth.isRunning) {
            this.mouth.stop();
            this.refreshMicButton();
            this.showMessage('マイクを止めました');
            return;
        }
        try {
            await this.mouth.start();
            this.showMessage('マイクを使っています。話すと口が動きます');
        } catch (error) {
            const isDenied = error.name === 'NotAllowedError';
            this.showMessage(isDenied ? 'マイクの使用が許可されませんでした' : `マイクを使えません：${error.message}`);
        }
        this.refreshMicButton();
    }

    refreshMicButton()
    {
        const isRunning = this.mouth.isRunning;
        this.el.mic.textContent = isRunning ? 'マイクを止める' : 'マイクを使う';
        this.el.mic.classList.toggle('primary', !isRunning);
    }

    tick(now)
    {
        this.mouth.update(now);
        this.view.render({ now, isEyesClosed: this.blinker.isClosed(now), isMouthOpen: this.mouth.isOpen });
        this.refreshMeter();
        requestAnimationFrame((next) => this.tick(next));
    }

    refreshMeter()
    {
        this.el.meter.style.width = `${AvatarApp.meterPercent(this.mouth.level)}%`;
        this.el.meter.classList.toggle('is-open', this.mouth.isOpen);
        this.el.threshold.style.left = `${AvatarApp.meterPercent(this.mouth.threshold)}%`;
    }

    static meterPercent(level)
    {
        const low = Math.log10(kMeterMinLevel);
        const high = Math.log10(kMeterMaxLevel);
        const t = (Math.log10(Math.max(level, kMeterMinLevel)) - low) / (high - low);
        return Math.min(100, Math.max(0, t * 100));
    }

    setUiHidden(isHidden)
    {
        document.body.classList.toggle('is-ui-hidden', isHidden);
    }

    applyBackground(name)
    {
        const background = kAvatarBackgrounds.includes(name) ? name : kDefaultAvatarBackground;
        document.body.dataset.background = background;
        this.el.background.value = background;
    }

    showMessage(text)
    {
        this.el.message.textContent = text;
    }

    // 保存できない環境（プライベートウィンドウなど）でも動くよう、失敗は気にしない
    loadSettings()
    {
        let settings = {};
        try {
            settings = JSON.parse(localStorage.getItem(kAvatarSettingsKey)) ?? {};
        } catch {
            settings = {};
        }
        const sensitivity = Number(settings.sensitivity);
        this.mouth.sensitivity = sensitivity >= 1 && sensitivity <= 100 ? sensitivity : kDefaultVoiceSensitivity;
        this.el.sensitivity.value = String(this.mouth.sensitivity);
        this.applyBackground(settings.background);
    }

    saveSettings()
    {
        const settings = { sensitivity: this.mouth.sensitivity, background: document.body.dataset.background };
        try {
            localStorage.setItem(kAvatarSettingsKey, JSON.stringify(settings));
        } catch {
            // 覚えられなくても、今の画面ではそのまま使える
        }
    }
}

window.avatarApp = new AvatarApp();
