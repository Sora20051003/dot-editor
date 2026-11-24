'use strict';

// 声に反応する強さ（1〜100）の初期値
const kDefaultVoiceSensitivity = 60;
// 強さ 1 と 100 のときに口を開ける音の大きさ（RMS）。間は対数で変える（耳の感じ方に近いため）
const kVoiceThresholdAtLow = 0.2;
const kVoiceThresholdAtHigh = 0.002;
// 声が途切れても、この時間は口を開けたままにする（言葉の間で口がパタパタしすぎないように）
const kMouthHoldMs = 120;
// 大きさの表示が急に落ちないよう、前の値を少し残す
const kVoiceLevelDecay = 0.85;
const kAnalyserSize = 1024;

// マイクの音の大きさから、口を開けるかどうかを決める
class MouthByVoice
{
    constructor()
    {
        this.sensitivity = kDefaultVoiceSensitivity;
        this.level = 0;
        this.isOpen = false;
        this.lastLoudAt = -Infinity;
        this.stream = null;
        this.audio = null;
        this.analyser = null;
        this.samples = new Float32Array(kAnalyserSize);
    }

    get isRunning()
    {
        return this.analyser !== null;
    }

    // ボタンを押したときに呼ぶ（ブラウザは、人の操作なしに音を扱うことを許さないため）
    async start()
    {
        if (this.isRunning) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('このブラウザではマイクを使えません（https か、exe・ローカルのページで開いてください）');
        }
        const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.audio = new AudioContext();
        const source = this.audio.createMediaStreamSource(this.stream);
        this.analyser = this.audio.createAnalyser();
        this.analyser.fftSize = kAnalyserSize;
        source.connect(this.analyser);
    }

    stop()
    {
        this.stream?.getTracks().forEach((track) => track.stop());
        this.audio?.close();
        this.stream = null;
        this.audio = null;
        this.analyser = null;
        this.level = 0;
        this.isOpen = false;
    }

    get threshold()
    {
        const t = (this.sensitivity - 1) / 99;
        return kVoiceThresholdAtLow * Math.pow(kVoiceThresholdAtHigh / kVoiceThresholdAtLow, t);
    }

    update(now)
    {
        if (!this.isRunning) return;
        this.analyser.getFloatTimeDomainData(this.samples);
        let sum = 0;
        for (const value of this.samples) sum += value * value;
        const rms = Math.sqrt(sum / this.samples.length);
        this.level = Math.max(rms, this.level * kVoiceLevelDecay);
        if (rms >= this.threshold) {
            this.isOpen = true;
            this.lastLoudAt = now;
        } else if (now - this.lastLoudAt > kMouthHoldMs) {
            this.isOpen = false;
        }
    }
}
