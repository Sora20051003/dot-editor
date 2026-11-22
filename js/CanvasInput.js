'use strict';

const kLeftButton = 0;
const kMiddleButton = 1;
const kRightButton = 2;
// マウスのホイール1目盛りぶん。トラックパッドの細かい動きはためてから1段ズームする
const kWheelStepDelta = 50;
const kWheelLinePixels = 33;

// 2本指で触れて離すまでがこれより短く、ほとんど動かなければ「2本指タップ」（取り消し）とみなす
const kTwoFingerTapMaxMs = 300;
const kTwoFingerTapMaxMovePx = 12;

const InputMode = Object.freeze({ None: 'none', Draw: 'draw', Pan: 'pan', Gesture: 'gesture' });

// 描画エリアのマウス・ペン・タッチ操作を、描く／スクロール／ズームに振り分ける
class CanvasInput
{
    // handlers: onDrawBegin(x, y, modifiers), onDrawMove(x, y), onDrawEnd(), onDrawCancel(),
    //           onHover(pixel | null), onViewChanged(), onTwoFingerTap()（なくてもよい）
    constructor(stage, view, handlers)
    {
        this.stage = stage;
        this.view = view;
        this.handlers = handlers;
        this.mode = InputMode.None;
        this.pointerId = null;
        this.lastClientX = 0;
        this.lastClientY = 0;
        this.wheelRemainder = 0;
        this.isSpaceHeld = false;
        // 画面に触れている指（pointerId → 画面上の位置）。2本になったら拡大・移動に切り替える
        this.touches = new Map();
        this.gesture = null;
        this.bindEvents();
    }

    bindEvents()
    {
        const stage = this.stage;
        stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        stage.addEventListener('pointermove', (e) => this.onPointerMove(e));
        stage.addEventListener('pointerup', (e) => this.onPointerUp(e));
        stage.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        stage.addEventListener('pointerleave', () => this.onPointerLeave());
        stage.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        stage.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('keydown', (e) => this.onSpaceKey(e, true));
        window.addEventListener('keyup', (e) => this.onSpaceKey(e, false));
        window.addEventListener('blur', () => this.setSpaceHeld(false));
    }

    toLocal(e)
    {
        const rect = this.view.canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    toPixel(e)
    {
        const local = this.toLocal(e);
        return this.view.toPixel(local.x, local.y);
    }

    onPointerDown(e)
    {
        if (e.pointerType === 'touch' && this.onTouchDown(e)) return;
        if (this.mode !== InputMode.None) return;
        const isPan = e.button === kMiddleButton || (e.button === kLeftButton && this.isSpaceHeld);
        const isDraw = !isPan && (e.button === kLeftButton || e.button === kRightButton);
        if (!isPan && !isDraw) return;

        e.preventDefault();
        this.stage.setPointerCapture(e.pointerId);
        this.pointerId = e.pointerId;
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;
        this.mode = isPan ? InputMode.Pan : InputMode.Draw;
        this.updateCursor();
        if (isDraw) {
            const pixel = this.toPixel(e);
            const modifiers = { isSecondary: e.button === kRightButton, isAlt: e.altKey };
            this.handlers.onDrawBegin(pixel.x, pixel.y, modifiers);
        }
    }

    onPointerMove(e)
    {
        if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (this.mode === InputMode.Gesture) {
                this.updateGesture();
                return;
            }
        }
        const isOwnPointer = e.pointerId === this.pointerId;
        if (this.mode === InputMode.Pan && isOwnPointer) {
            this.view.panBy(e.clientX - this.lastClientX, e.clientY - this.lastClientY);
            this.lastClientX = e.clientX;
            this.lastClientY = e.clientY;
            this.handlers.onViewChanged();
            return;
        }
        if (this.mode === InputMode.Draw && isOwnPointer) this.forwardDrawMoves(e);
        this.handlers.onHover(this.toPixel(e));
    }

    // 速く動かしたときの途中の点も拾って、線をなめらかにする
    forwardDrawMoves(e)
    {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const moves = events.length > 0 ? events : [e];
        for (const move of moves) {
            const pixel = this.toPixel(move);
            this.handlers.onDrawMove(pixel.x, pixel.y);
        }
    }

    onPointerUp(e)
    {
        if (e.pointerType === 'touch') {
            this.touches.delete(e.pointerId);
            if (this.mode === InputMode.Gesture) {
                if (this.touches.size === 0) this.endGesture();
                return;
            }
        }
        if (e.pointerId !== this.pointerId) return;
        const wasDrawing = this.mode === InputMode.Draw;
        this.mode = InputMode.None;
        this.pointerId = null;
        this.updateCursor();
        if (wasDrawing) this.handlers.onDrawEnd();
    }

    // ---- スマホ：2本指で拡大・移動 ----
    // 戻り値は「この指はここで処理し終えたか」（1本目なら false を返して、普段どおり描き始める）
    onTouchDown(e)
    {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.mode === InputMode.Gesture || this.touches.size > 2) return true;
        if (this.touches.size < 2) return false;
        e.preventDefault();
        this.stage.setPointerCapture(e.pointerId);
        // 1本目の指で描き始めた線は、2本目が来た時点で取り消す（拡大のつもりで線が残らないように）
        if (this.mode === InputMode.Draw) this.handlers.onDrawCancel();
        this.mode = InputMode.Gesture;
        this.pointerId = null;
        const { midpoint, distance } = this.measureTouches();
        this.gesture = {
            startedAt: performance.now(), startZoom: this.view.zoom, startDistance: Math.max(1, distance),
            startMidpoint: midpoint, lastMidpoint: midpoint, hasMoved: false,
        };
        return true;
    }

    measureTouches()
    {
        const [a, b] = [...this.touches.values()];
        const rect = this.view.canvas.getBoundingClientRect();
        const midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        return { midpoint, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }

    // 指の間の距離の比で拡大し、2本の指の真ん中が動いたぶんだけ移動する
    updateGesture()
    {
        if (this.touches.size < 2) return;
        const gesture = this.gesture;
        const { midpoint, distance } = this.measureTouches();
        this.view.panBy(midpoint.x - gesture.lastMidpoint.x, midpoint.y - gesture.lastMidpoint.y);
        this.view.zoomAt(gesture.startZoom * (distance / gesture.startDistance), midpoint.x, midpoint.y);
        gesture.lastMidpoint = midpoint;
        const moved = Math.hypot(midpoint.x - gesture.startMidpoint.x, midpoint.y - gesture.startMidpoint.y);
        const pinched = Math.abs(distance - gesture.startDistance);
        if (moved > kTwoFingerTapMaxMovePx || pinched > kTwoFingerTapMaxMovePx) gesture.hasMoved = true;
        this.handlers.onViewChanged();
    }

    endGesture()
    {
        const gesture = this.gesture;
        this.gesture = null;
        this.mode = InputMode.None;
        this.updateCursor();
        const isTap = !gesture.hasMoved && performance.now() - gesture.startedAt < kTwoFingerTapMaxMs;
        if (isTap && this.handlers.onTwoFingerTap) this.handlers.onTwoFingerTap();
    }

    onPointerLeave()
    {
        if (this.mode === InputMode.None) this.handlers.onHover(null);
    }

    onWheel(e)
    {
        e.preventDefault();
        this.wheelRemainder += this.normalizeWheelDelta(e);
        const steps = Math.trunc(this.wheelRemainder / kWheelStepDelta);
        if (steps === 0) return;
        this.wheelRemainder -= steps * kWheelStepDelta;
        const local = this.toLocal(e);
        for (let i = 0; i < Math.abs(steps); i++) {
            this.view.stepZoom(steps < 0 ? 1 : -1, local.x, local.y);
        }
        this.handlers.onViewChanged();
        this.handlers.onHover(this.toPixel(e));
    }

    normalizeWheelDelta(e)
    {
        if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * kWheelLinePixels;
        if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * this.view.viewHeight;
        return e.deltaY;
    }

    onSpaceKey(e, isDown)
    {
        if (e.code !== 'Space' || CanvasInput.isTypingTarget(e.target)) return;
        // ボタンにフォーカスがあるとスペースで押されてしまうので止める
        e.preventDefault();
        this.setSpaceHeld(isDown);
    }

    setSpaceHeld(isHeld)
    {
        this.isSpaceHeld = isHeld;
        this.updateCursor();
    }

    updateCursor()
    {
        const isGrab = this.mode === InputMode.Pan || this.isSpaceHeld;
        this.stage.classList.toggle('is-grab', isGrab);
        this.stage.classList.toggle('is-grabbing', this.mode === InputMode.Pan);
    }

    static isTypingTarget(target)
    {
        if (!(target instanceof HTMLElement)) return false;
        if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
        return target.tagName === 'INPUT' && ['text', 'number'].includes(target.type);
    }
}
