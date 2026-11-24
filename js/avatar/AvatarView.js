'use strict';

// 絵のまわりに残す余白（画面の割合）
const kAvatarMargin = 0.04;
// 頭を傾けるときの中心＝首の位置（絵の幅・高さに対する割合）
const kHeadPivotX = 0.5;
const kHeadPivotY = 0.62;
// 頭の傾きの上限。読み取りの間違いで首が折れたように見えないよう、ここで止める
const kMaxHeadRoll = 30 * Math.PI / 180;
// 顔の向き（両目の幅に対する鼻のずれ）を、頭の部品をずらす量（絵の幅・高さに対する割合）に直す係数と上限
const kHeadShiftPerTurn = 0.06;
const kMaxHeadShift = 0.03;

// アバターの部品を重ねて描く。自分では動かず、カメラで読み取った頭の向き・目・口のとおりにだけ動かす
class AvatarView
{
    constructor(canvas)
    {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.model = null;
    }

    setModel(model)
    {
        this.model = model;
    }

    // state: { roll, yaw, pitch, isEyesClosed, isMouthOpen }（FaceTracker の値。カメラなしならすべて 0 / false）
    render(state)
    {
        this.fitCanvasToScreen();
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.model === null) return;
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
            if (part.role !== 'body') this.applyHeadPose(state);
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

    applyHeadPose(state)
    {
        const { width, height } = this.model;
        const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
        const pivotX = width * kHeadPivotX;
        const pivotY = height * kHeadPivotY;
        const shiftX = clamp(state.yaw * kHeadShiftPerTurn, kMaxHeadShift) * width;
        const shiftY = clamp(state.pitch * kHeadShiftPerTurn, kMaxHeadShift) * height;
        this.ctx.translate(pivotX + shiftX, pivotY + shiftY);
        this.ctx.rotate(clamp(state.roll, kMaxHeadRoll));
        this.ctx.translate(-pivotX, -pivotY);
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
