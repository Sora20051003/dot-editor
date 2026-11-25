'use strict';

// 最初に読むアバター（公開版・exe 版。file:// では読めないので「絵を開く」から選んでもらう）。
// 8192 版を読めない端末（iPhone など、大きな絵を作れないもの）は 4096 版にする
const kDefaultAvatarUrls = Object.freeze(['models/vtuber-avatar.dotart', 'models/vtuber-avatar-4096.dotart']);
const kAvatarSettingsKey = 'dotAvatarSettings';
const kAvatarBackgrounds = Object.freeze(['green', 'blue', 'transparent', 'dark']);
const kDefaultAvatarBackground = 'green';
// 目を閉じた・口を開けたとみなす値（MediaPipe の 0〜1）。開け閉めの境目でパタパタしないよう、閉じる側と開く側で差を付ける
const kEyesCloseAt = 0.5;
const kEyesOpenAt = 0.35;
const kMouthOpenAt = 0.18;
const kMouthCloseAt = 0.1;
// 顔を映さないカメラ（HDMI のキャプチャ機器・配信ソフトの仮想カメラ）の名前。「自動」のときはこれを避ける。
// ブラウザは最初に見つけたカメラを選ぶので、キャプチャ機器が先に並ぶ PC では顔が映らなかったため
const kNonFaceCameraPattern = /capture|virtual|obs|mirabox|elgato|ndi/i;

// アバターの画面。カメラの読み取りと描く部品をつなぎ、画面のボタンと結ぶ
class AvatarApp
{
    constructor()
    {
        const byId = (id) => document.getElementById(id);
        this.el = {
            canvas: byId('avatarCanvas'),
            camera: byId('btnCamera'),
            cameraSelect: byId('cameraSelect'),
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
        // 利用者が選んだカメラの deviceId。空なら「自動」
        this.cameraId = '';
        this.loadSettings();
        this.bindEvents();
        this.refreshCameraUi();
        this.refreshCameraList();
        if (new URLSearchParams(location.search).has('hideui')) this.setUiHidden(true);
        this.loadDefaultModel();
        requestAnimationFrame((now) => this.tick(now));
    }

    bindEvents()
    {
        const el = this.el;
        el.camera.addEventListener('click', () => this.toggleCamera());
        el.cameraSelect.addEventListener('change', () => this.changeCamera(el.cameraSelect.value));
        navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshCameraList());
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
        let lastError = null;
        for (const url of kDefaultAvatarUrls) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`読み込めませんでした（${response.status}）`);
                this.showMessage('アバターを読んでいます…');
                this.applyModel(await AvatarModel.fromBlob(await response.blob()), 'アバター');
                return;
            } catch (error) {
                lastError = error;
            }
        }
        this.showMessage(`最初のアバターを読めませんでした：${lastError.message}`);
    }

    async loadModel(blob, label)
    {
        this.showMessage(`${label} を読んでいます…`);
        try {
            this.applyModel(await AvatarModel.fromBlob(blob), label);
        } catch (error) {
            this.showMessage(`開けませんでした：${error.message}`);
        }
    }

    applyModel(model, label)
    {
        this.view.setModel(model);
        const missing = model.missingRoleNames;
        this.showMessage(missing.length === 0
            ? `${label} を読みました`
            : `${label} を読みました。動きに使うレイヤーが見つかりません：${missing.join('・')}`);
    }

    async toggleCamera()
    {
        if (this.tracker.isRunning) {
            this.tracker.stop();
            this.refreshCameraUi();
            this.showMessage('カメラを止めました。アバターは止まったままになります');
            return;
        }
        await this.startCamera();
    }

    // 別のカメラを選んだとき。使っている途中ならすぐ切り替える
    async changeCamera(deviceId)
    {
        this.cameraId = deviceId;
        this.saveSettings();
        if (!this.tracker.isRunning) return;
        this.tracker.stop();
        await this.startCamera();
    }

    async startCamera()
    {
        this.el.camera.disabled = true;
        this.el.cameraSelect.disabled = true;
        this.showMessage('顔の読み取りを準備しています…');
        try {
            await this.startPreferredCamera();
            this.showMessage(`カメラ（${this.currentCameraLabel()}）を使っています。最初の一瞬の顔の向きを正面にします`);
        } catch (error) {
            const isDenied = error.name === 'NotAllowedError';
            this.showMessage(isDenied ? 'カメラの使用が許可されませんでした' : `カメラを使えません：${error.message}`);
        }
        this.el.camera.disabled = false;
        this.el.cameraSelect.disabled = false;
        this.refreshCameraUi();
    }

    // 選んだカメラがあればそれを、なければ顔を映すカメラを使う。
    // カメラの名前は使う許可をもらうまで分からないので、自動のときは一度ブラウザの選ぶカメラで始めてから選び直す
    async startPreferredCamera()
    {
        if (this.cameraId !== '') {
            try {
                await this.tracker.start(this.el.video, this.cameraId);
                await this.refreshCameraList();
                return;
            } catch (error) {
                // 選んだカメラが外されていたら自動に戻す（許可されなかったときはそのまま知らせる）
                if (error.name === 'NotAllowedError') throw error;
            }
        }
        await this.tracker.start(this.el.video);
        const cameras = await this.refreshCameraList();
        const current = cameras.find((camera) => camera.deviceId === this.tracker.deviceId);
        const faceCamera = cameras.find((camera) => !kNonFaceCameraPattern.test(camera.label));
        if (current === undefined || faceCamera === undefined) return;
        if (!kNonFaceCameraPattern.test(current.label) || faceCamera.deviceId === current.deviceId) return;
        this.tracker.stop();
        await this.tracker.start(this.el.video, faceCamera.deviceId);
    }

    // カメラの一覧を選ぶ欄に並べ直し、一覧を返す
    async refreshCameraList()
    {
        if (!navigator.mediaDevices?.enumerateDevices) return [];
        let cameras = [];
        try {
            cameras = (await navigator.mediaDevices.enumerateDevices())
                .filter((device) => device.kind === 'videoinput' && device.deviceId !== '');
        } catch {
            return [];
        }
        const select = this.el.cameraSelect;
        select.replaceChildren(select.options[0]);
        cameras.forEach((camera, index) => select.add(new Option(camera.label || `カメラ ${index + 1}`, camera.deviceId)));
        this.syncCameraSelect();
        return cameras;
    }

    // 選ぶ欄の表示を合わせる。自動のまま使っているときは「自動」のままにする（次も自動で選び直すため）
    syncCameraSelect()
    {
        const select = this.el.cameraSelect;
        const hasChosen = [...select.options].some((option) => option.value === this.cameraId);
        select.value = hasChosen ? this.cameraId : '';
    }

    currentCameraLabel()
    {
        const option = [...this.el.cameraSelect.options].find((o) => o.value !== '' && o.value === this.tracker.deviceId);
        return option?.textContent ?? '名前不明';
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
        this.cameraId = typeof settings.cameraId === 'string' ? settings.cameraId : '';
    }

    saveSettings()
    {
        try {
            localStorage.setItem(kAvatarSettingsKey, JSON.stringify({ background: document.body.dataset.background, cameraId: this.cameraId }));
        } catch {
            // 覚えられなくても、今の画面ではそのまま使える
        }
    }
}

window.avatarApp = new AvatarApp();
