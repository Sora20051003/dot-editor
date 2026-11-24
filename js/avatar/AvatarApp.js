'use strict';

// 最初に読むアバター（公開版・exe 版。file:// では読めないので「絵を開く」から選んでもらう）
const kDefaultAvatarUrl = 'models/vtuber-avatar.dotart';
const kAvatarSettingsKey = 'dotAvatarSettings';
const kAvatarBackgrounds = Object.freeze(['green', 'blue', 'transparent', 'dark']);
const kDefaultAvatarBackground = 'green';
// 目を閉じた・口を開けたとみなす値（MediaPipe の 0〜1）。開け閉めの境目でパタパタしないよう、閉じる側と開く側で差を付ける
const kEyesCloseAt = 0.5;
const kEyesOpenAt = 0.35;
const kMouthOpenAt = 0.18;
const kMouthCloseAt = 0.1;

// アバターの画面。カメラの読み取りと描く部品をつなぎ、画面のボタンと結ぶ
class AvatarApp
{
    constructor()
    {
        const byId = (id) => document.getElementById(id);
        this.el = {
            canvas: byId('avatarCanvas'),
            camera: byId('btnCamera'),
            recenter: byId('btnRecenter'),
            video: byId('cameraPreview'),
            faceStatus: byId('faceStatus'),
            background: byId('avatarBackground'),
            open: byId('btnOpenAvatar'),
            fileInput: byId('avatarFileInput'),
            hide: byId('btnHideUi'),
            message: byId('avatarMessage'),
        };
        this.view = new AvatarView(this.el.canvas);
        this.tracker = new FaceTracker();
        this.isEyesClosed = false;
        this.isMouthOpen = false;
        this.loadSettings();
        this.bindEvents();
        this.refreshCameraUi();
        if (new URLSearchParams(location.search).has('hideui')) this.setUiHidden(true);
        this.loadDefaultModel();
        requestAnimationFrame((now) => this.tick(now));
    }

    bindEvents()
    {
        const el = this.el;
        el.camera.addEventListener('click', () => this.toggleCamera());
        el.recenter.addEventListener('click', () => {
            this.tracker.recenter();
            this.showMessage('今の顔の向きを正面にしました');
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

    async toggleCamera()
    {
        if (this.tracker.isRunning) {
            this.tracker.stop();
            this.refreshCameraUi();
            this.showMessage('カメラを止めました。アバターは止まったままになります');
            return;
        }
        this.el.camera.disabled = true;
        this.showMessage('顔の読み取りを準備しています…');
        try {
            await this.tracker.start(this.el.video);
            this.showMessage('カメラを使っています。最初の一瞬の顔の向きを正面にします');
        } catch (error) {
            const isDenied = error.name === 'NotAllowedError';
            this.showMessage(isDenied ? 'カメラの使用が許可されませんでした' : `カメラを使えません：${error.message}`);
        }
        this.el.camera.disabled = false;
        this.refreshCameraUi();
    }

    refreshCameraUi()
    {
        const isRunning = this.tracker.isRunning;
        this.el.camera.textContent = isRunning ? 'カメラを止める' : 'カメラを使う';
        this.el.camera.classList.toggle('primary', !isRunning);
        this.el.recenter.disabled = !isRunning;
        this.el.video.hidden = !isRunning;
    }

    tick(now)
    {
        this.tracker.update(now);
        const face = this.tracker.state;
        this.isEyesClosed = AvatarApp.withHysteresis(this.isEyesClosed, face.eyesClosed, kEyesCloseAt, kEyesOpenAt);
        this.isMouthOpen = AvatarApp.withHysteresis(this.isMouthOpen, face.jawOpen, kMouthOpenAt, kMouthCloseAt);
        this.view.render({
            roll: face.roll,
            yaw: face.yaw,
            pitch: face.pitch,
            isEyesClosed: face.hasFace && this.isEyesClosed,
            isMouthOpen: face.hasFace && this.isMouthOpen,
        });
        this.refreshFaceStatus(face);
        requestAnimationFrame((next) => this.tick(next));
    }

    // 今が「オン」なら offAt を下回るまでオンのまま、「オフ」なら onAt を超えるまでオフのまま
    static withHysteresis(isOn, value, onAt, offAt)
    {
        return isOn ? value > offAt : value >= onAt;
    }

    refreshFaceStatus(face)
    {
        let text = '';
        if (this.tracker.isRunning) text = face.hasFace ? '顔を読み取っています' : '顔が見つかりません';
        if (this.el.faceStatus.textContent !== text) this.el.faceStatus.textContent = text;
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
        this.applyBackground(settings.background);
    }

    saveSettings()
    {
        try {
            localStorage.setItem(kAvatarSettingsKey, JSON.stringify({ background: document.body.dataset.background }));
        } catch {
            // 覚えられなくても、今の画面ではそのまま使える
        }
    }
}

window.avatarApp = new AvatarApp();
