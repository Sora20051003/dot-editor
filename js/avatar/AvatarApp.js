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
// カメラを開けなかった理由（getUserMedia のエラーの名前ごと）。どれでもなければブラウザの文をそのまま出す。
// Windows でカメラが固まっていると AbortError（Timeout starting video source）になった
const kCameraBusyReason = 'ほかのアプリが使っているか、カメラが応答していません。カメラを使うアプリを閉じるか、PC を再起動してください';
const kCameraMissingReason = 'カメラが見つかりません（外されたなど）';
const kCameraErrorReasons = Object.freeze({
    NotReadableError: kCameraBusyReason,
    AbortError: kCameraBusyReason,
    NotFoundError: kCameraMissingReason,
    OverconstrainedError: kCameraMissingReason,
});

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
        this.signal = new VideoSignalCheck();
        this.wasNoSignal = false;
        // 最後にカメラを始めたとき、開けなかったカメラの知らせ（なければ空）
        this.cameraFailureText = '';
        // カメラを始めている途中か。途中で映像を測ると、知らせが「使っています」で上書きされるので、終わってから測る
        this.isCameraStarting = false;
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
        this.isCameraStarting = true;
        this.cameraFailureText = '';
        try {
            const failures = await this.startPreferredCamera();
            this.cameraFailureText = failures.join('');
            const using = `カメラ（${this.currentCameraLabel()}）を使っています`;
            this.showMessage(failures.length === 0
                ? `${using}。最初の一瞬の顔の向きを正面にします`
                : `${failures.join('')}代わりに${using}`);
        } catch (error) {
            const isDenied = error.name === 'NotAllowedError';
            this.showMessage(isDenied ? 'カメラの使用が許可されませんでした' : `カメラを使えません：${AvatarApp.cameraErrorReason(error)}`);
        }
        this.signal.reset();
        this.wasNoSignal = false;
        this.isCameraStarting = false;
        this.el.camera.disabled = false;
        this.el.cameraSelect.disabled = false;
        this.refreshCameraUi();
    }

    // 選んだカメラがあればそれを、なければ顔を映すカメラを使う。開けなかったカメラの知らせ（文）の一覧を返す。
    // カメラの名前は使う許可をもらうまで分からないので、自動のときは一度ブラウザの選ぶカメラで始めてから選び直す
    async startPreferredCamera()
    {
        const failures = [];
        const failedIds = new Set();
        if (this.cameraId !== '') {
            try {
                await this.tracker.start(this.el.video, this.cameraId);
                await this.refreshCameraList();
                return failures;
            } catch (error) {
                // 選んだカメラを開けなければ自動に戻す（許可されなかったときはそのまま知らせる）。黙って戻すと、
                // 真っ黒なキャプチャ機器が使われても理由が分からないので、開けなかったことを知らせる
                if (error.name === 'NotAllowedError') throw error;
                failures.push(AvatarApp.openFailureText(this.cameraLabelOf(this.cameraId), error));
                failedIds.add(this.cameraId);
            }
        }
        await this.tracker.start(this.el.video);
        const cameras = await this.refreshCameraList();
        const current = cameras.find((camera) => camera.deviceId === this.tracker.deviceId);
        const faceCamera = cameras.find((camera) => !kNonFaceCameraPattern.test(camera.label) && !failedIds.has(camera.deviceId));
        if (current === undefined || faceCamera === undefined) return failures;
        if (!kNonFaceCameraPattern.test(current.label) || faceCamera.deviceId === current.deviceId) return failures;
        this.tracker.stop();
        try {
            await this.tracker.start(this.el.video, faceCamera.deviceId);
        } catch (error) {
            // 顔を映すカメラが開けなくても、止めずに最初のカメラへ戻して知らせる
            if (error.name === 'NotAllowedError') throw error;
            failures.push(AvatarApp.openFailureText(faceCamera.label, error));
            await this.tracker.start(this.el.video, current.deviceId);
        }
        return failures;
    }

    static openFailureText(label, error)
    {
        return `${label} を開けませんでした（${AvatarApp.cameraErrorReason(error)}）。`;
    }

    static cameraErrorReason(error)
    {
        return kCameraErrorReasons[error.name] ?? error.message;
    }

    // 選ぶ欄に並んでいるカメラの名前。見つからなければ fallback
    cameraLabelOf(deviceId, fallback = '選んだカメラ')
    {
        const option = [...this.el.cameraSelect.options].find((o) => o.value !== '' && o.value === deviceId);
        return option?.textContent ?? fallback;
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
        return this.cameraLabelOf(this.tracker.deviceId, '名前不明');
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
        if (this.tracker.isRunning && !this.isCameraStarting) this.signal.update(this.el.video, now);
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

    // 映像が出ていないときは「顔が見つかりません」と区別する（顔ではなくカメラを直す必要があるため）
    refreshFaceStatus(face)
    {
        const isRunning = this.tracker.isRunning;
        const isNoSignal = isRunning && !this.isCameraStarting && this.signal.isNoSignal;
        if (isNoSignal && !this.wasNoSignal) {
            // 開けなかったカメラの知らせも残す（どちらも分かると、何を直せばよいか分かる）
            this.showMessage(`${this.cameraFailureText}カメラ（${this.currentCameraLabel()}）の映像が出ていません（真っ黒・一色のまま）。`
                + '「使うカメラ」で顔を映すカメラを選ぶか、カメラのシャッターを確かめてください');
        }
        this.wasNoSignal = isNoSignal;
        let text = '';
        if (isNoSignal) text = 'カメラの映像が出ていません';
        else if (isRunning) text = face.hasFace ? '顔を読み取っています' : '顔が見つかりません';
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
