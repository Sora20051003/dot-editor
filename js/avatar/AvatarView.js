'use strict';

// 絵のまわりに残す余白（画面の割合）
const kAvatarMargin = 0.04;
// 首の位置（絵の高さに対する割合）。頭は左右には傾けず、上下にだけ動かす（利用者の希望で横揺れをなくした）
const kHeadPivotY = 0.62;
// 話しているときに頭が少し上がる量（絵の高さに対する割合）と、戻る速さ
const kTalkBobAmount = 0.008;
const kTalkBobEase = 0.25;
// 呼吸：体を下の端を中心に、縦にわずかに伸び縮みさせる
const kBreathPeriodMs = 3400;
const kBreathScale = 0.006;

// アバターの部品を重ねて描く。目と口は状態に合わせて出し入れし、頭と体を別々にゆらす
class AvatarView
{
    constructor(canvas)
    {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.model = null;
        this.talkBob = 0;
    }

    setModel(model)
    {
        this.model = model;
    }

    // state: { now, isEyesClosed, isMouthOpen }
    render(state)
    {
        this.fitCanvasToScreen();
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.model === null) return;
        this.talkBob += ((state.isMouthOpen ? 1 : 0) - this.talkBob) * kTalkBobEase;
        const model = this.model;
        const scale = this.fitScale();
        ctx.save();
        ctx.translate((this.canvas.width - model.width * scale) / 2, (this.canvas.height - model.height * scale) / 2);
        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (const part of model.parts) {
            if (!this.isPartShown(part, state)) continue;
            ctx.save();
            if (part.role === 'body') this.applyBreath(state.now);
            else this.applyHeadMotion(state.now);
            ctx.globalAlpha = part.opacity;
            ctx.drawImage(part.image, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }

    isPartShown(part, state)
    {
        const model = this.model;
        switch (part.role) {
            case 'eyesOpen': return !state.isEyesClosed || !model.hasRole('eyesClosed');
            case 'eyesClosed': return state.isEyesClosed;
            case 'mouthOpen': return state.isMouthOpen;
            case 'mouthClosed': return !state.isMouthOpen || !model.hasRole('mouthOpen');
            default: return true;
        }
    }

    applyBreath(now)
    {
        const { width, height } = this.model;
        const stretch = 1 + Math.sin((now / kBreathPeriodMs) * Math.PI * 2) * kBreathScale;
        this.ctx.translate(width / 2, height);
        this.ctx.scale(1, stretch);
        this.ctx.translate(-width / 2, -height);
    }

    applyHeadMotion(now)
    {
        const height = this.model.height;
        const pivotY = height * kHeadPivotY;
        // 呼吸で体が伸びた分だけ頭も上下させ、首が離れないようにする
        const breathLift = Math.sin((now / kBreathPeriodMs) * Math.PI * 2) * kBreathScale * (height - pivotY);
        const lift = this.talkBob * kTalkBobAmount * height + breathLift;
        this.ctx.translate(0, -lift);
    }

    fitScale()
    {
        const usable = 1 - kAvatarMargin * 2;
        return Math.min(this.canvas.width * usable / this.model.width, this.canvas.height * usable / this.model.height);
    }

    fitCanvasToScreen()
    {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.round(this.canvas.clientWidth * dpr);
        const height = Math.round(this.canvas.clientHeight * dpr);
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
    }
}
