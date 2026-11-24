'use strict';

// MediaPipe の置き場所（アプリと一緒に置いている。vendor/mediapipe/README.md）
const kMediaPipeDir = 'vendor/mediapipe/';
const kCameraWidth = 640;
const kCameraHeight = 480;
// 顔の目印の番号（MediaPipe Face Landmarker の 478 点）。目の外側の端と鼻の頭
const kLandmarkEyeOuterA = 33;
const kLandmarkEyeOuterB = 263;
const kLandmarkNoseTip = 1;
// 読み取った値の細かい震えをならす割合（1 に近いほど前の値を残す）
const kPoseSmoothing = 0.6;
// 正面の向きを決めるために平均する回数（カメラを使い始めたときと、「正面にする」を押したとき）
const kCalibrationFrames = 15;
// 顔を見失ってからこの時間がたったら、正面の止まった形に戻す
const kFaceLostMs = 500;
// MediaPipe の回転の向きを、鏡で見たときの向き（今までの鼻のずれと同じ符号）に合わせる。テスト用の台形の映像で確かめた
// （鼻を右へずらすと回転の左右は増え、鼻のずれは減った。下へずらすと回転の上下は減り、鼻のずれは増えた。どちらも逆）
const kMatrixYawSign = -1;
const kMatrixPitchSign = -1;
// 回転が取れないときに、鼻のずれ（両目の幅に対する割合）を角度に直す目安（同じテストで、ずれ 0.074 が約 5.4°）
const kNoseRatioToRadians = 1.3;

// カメラの映像から、頭の傾き・向き・目の閉じ具合・口の開き具合を読み取る。
// 値は鏡に映したとき（配信でふつうの向き）に合わせる。読み取った以上に動かさないよう、ならすだけで増やさない
class FaceTracker
{
    constructor()
    {
        this.landmarker = null;
        this.stream = null;
        this.video = null;
        this.lastVideoTime = -1;
        this.lastFaceAt = -Infinity;
        this.neutral = { yaw: 0, pitch: 0 };
        this.calibration = [];
        this.state = FaceTracker.neutralState();
    }

    // roll：頭の傾き（ラジアン。画面で時計回りが正）。yaw / pitch：正面からの左右・上下の向き（ラジアン）
    static neutralState()
    {
        return { hasFace: false, roll: 0, yaw: 0, pitch: 0, eyesClosed: 0, jawOpen: 0 };
    }

    get isRunning()
    {
        return this.stream !== null;
    }

    // 今使っているカメラの deviceId（使っていなければ空）
    get deviceId()
    {
        return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? '';
    }

    // video は映像を流す <video>（画面の小窓にも使う）。deviceId が空なら、ブラウザが選ぶカメラを使う
    async start(video, deviceId = '')
    {
        if (this.isRunning) return;
        if (location.protocol === 'file:') {
            throw new Error('ファイルを直接開いたときは使えません。公開版か exe 版で開いてください');
        }
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラを使えません');
        if (this.landmarker === null) this.landmarker = await FaceTracker.createLandmarker();
        const which = deviceId !== '' ? { deviceId: { exact: deviceId } } : { facingMode: 'user' };
        const constraints = { video: { width: kCameraWidth, height: kCameraHeight, ...which }, audio: false };
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video = video;
        video.srcObject = this.stream;
        await video.play();
        this.recenter();
    }

    stop()
    {
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        if (this.video !== null) this.video.srcObject = null;
        this.video = null;
        this.state = FaceTracker.neutralState();
    }

    // 今の顔の向きを正面にする（カメラの置き場所が斜めでも、ふつうに座った向きを正面にできる）
    recenter()
    {
        this.calibration = [];
        this.neutral = { yaw: 0, pitch: 0 };
    }

    static async createLandmarker()
    {
        const url = (name) => new URL(kMediaPipeDir + name, location.href).href;
        // ES Modules を使わない決まり（DECISIONS.md）なので、MediaPipe だけ import() で後から読む。file:// では読めない
        const vision = await import(url('vision_bundle.js'));
        const fileset = { wasmLoaderPath: url('vision_wasm_internal.js'), wasmBinaryPath: url('vision_wasm_internal.wasm') };
        const options = (delegate) => ({
            baseOptions: { modelAssetPath: url('face_landmarker.task'), delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            // 頭の回転を角度で読むため（鼻の位置だけでは大きく向いたときの角度が分からない）
            outputFacialTransformationMatrixes: true,
        });
        // GPU が使えない PC もあるので、だめなら CPU で動かす
        try {
            return await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
        } catch {
            return vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
        }
    }

    update(now)
    {
        if (!this.isRunning || this.video.readyState < 2) return;
        if (this.video.currentTime === this.lastVideoTime) return;
        this.lastVideoTime = this.video.currentTime;
        const result = this.landmarker.detectForVideo(this.video, now);
        const landmarks = result.faceLandmarks?.[0];
        if (landmarks === undefined) {
            if (now - this.lastFaceAt > kFaceLostMs) this.state = FaceTracker.neutralState();
            return;
        }
        this.lastFaceAt = now;
        const measured = FaceTracker.measure(landmarks, result.faceBlendshapes?.[0], result.facialTransformationMatrixes?.[0]);
        this.applyMeasured(measured);
    }

    // matrix：MediaPipe の頭の回転（4×4、列ごとに並ぶ）。あれば左右・上下の向きを角度（ラジアン）で読む
    static measure(landmarks, blendshapes, matrix)
    {
        const a = landmarks[kLandmarkEyeOuterA];
        const b = landmarks[kLandmarkEyeOuterB];
        const nose = landmarks[kLandmarkNoseTip];
        // 映像の座標は横と縦で縮みが違うので、ピクセルの比に直してから角度を出す
        const dx = (b.x - a.x) * kCameraWidth;
        const dy = (b.y - a.y) * kCameraHeight;
        const eyeWidth = Math.hypot(dx, dy);
        const midX = (a.x + b.x) / 2 * kCameraWidth;
        const midY = (a.y + b.y) / 2 * kCameraHeight;
        const score = (name) => blendshapes?.categories.find((c) => c.categoryName === name)?.score ?? 0;
        // 回転が取れないときは、両目の幅に対する鼻のずれから大まかな角度にする
        const turn = FaceTracker.turnFromMatrix(matrix) ?? {
            yaw: -(nose.x * kCameraWidth - midX) / eyeWidth * kNoseRatioToRadians,
            pitch: (nose.y * kCameraHeight - midY) / eyeWidth * kNoseRatioToRadians,
        };
        return {
            // 鏡に映すと回る向きが逆になる
            roll: -Math.atan2(dy, dx),
            yaw: turn.yaw,
            pitch: turn.pitch,
            eyesClosed: (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2,
            jawOpen: score('jawOpen'),
        };
    }

    // 顔の正面の向き（回転の 3 列目）から、左右（yaw：鏡で見て右を向くと正）と上下（pitch：下を向くと正）の角度を出す
    static turnFromMatrix(matrix)
    {
        const m = matrix?.data;
        if (m === undefined || m.length < 16) return null;
        const forwardX = m[8];
        const forwardY = m[9];
        const forwardZ = m[10];
        return {
            yaw: kMatrixYawSign * Math.atan2(forwardX, forwardZ),
            pitch: kMatrixPitchSign * Math.atan2(forwardY, Math.hypot(forwardX, forwardZ)),
        };
    }

    applyMeasured(measured)
    {
        if (this.calibration.length < kCalibrationFrames) {
            this.calibration.push(measured);
            const average = (key) => this.calibration.reduce((sum, m) => sum + m[key], 0) / this.calibration.length;
            this.neutral = { yaw: average('yaw'), pitch: average('pitch') };
        }
        const current = { roll: measured.roll, yaw: measured.yaw - this.neutral.yaw, pitch: measured.pitch - this.neutral.pitch };
        // 顔を見つけた最初の1回は、ならす前の値がないのでそのまま使う
        const previous = this.state.hasFace ? this.state : current;
        const smooth = (key) => previous[key] * kPoseSmoothing + current[key] * (1 - kPoseSmoothing);
        this.state = {
            hasFace: true,
            roll: smooth('roll'),
            yaw: smooth('yaw'),
            pitch: smooth('pitch'),
            // 目と口は、閉じた・開いたがすぐ出るよう、ならさない
            eyesClosed: measured.eyesClosed,
            jawOpen: measured.jawOpen,
        };
    }
}
