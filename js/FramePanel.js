'use strict';

// コマの小さな絵の枠の大きさ（CSS px）。長い辺をこれに合わせる
const kFrameThumbCss = 44;

// 絵の下のコマの帯。コマの並び・再生ボタン・速さ・前のコマを薄く出すかを表示し、押されたことを App に伝える。
// コマを替える・消すなどは取り消し履歴や描きかけの線とも関わるので、実際の操作は App に任せる
class FramePanel
{
    // handlers: onSelect(index), onAdd(), onDuplicate(), onRemove(), onMove(direction),
    //           onTogglePlay(), onFpsChange(value), onOnionChange(isOn)
    constructor(frameSet, handlers)
    {
        this.frames = frameSet;
        this.handlers = handlers;
        const byId = (id) => document.getElementById(id);
        this.el = {
            list: byId('frameList'),
            play: byId('btnAnimPlay'),
            fps: byId('animFps'),
            onion: byId('chkOnion'),
            add: byId('btnFrameAdd'),
            duplicate: byId('btnFrameDup'),
            remove: byId('btnFrameDelete'),
            left: byId('btnFrameLeft'),
            right: byId('btnFrameRight'),
            label: byId('frameLabel'),
        };
        this.thumbnails = [];
        this.bindEvents();
    }

    bindEvents()
    {
        const el = this.el;
        el.play.addEventListener('click', () => this.handlers.onTogglePlay());
        el.add.addEventListener('click', () => this.handlers.onAdd());
        el.duplicate.addEventListener('click', () => this.handlers.onDuplicate());
        el.remove.addEventListener('click', () => this.handlers.onRemove());
        el.left.addEventListener('click', () => this.handlers.onMove(-1));
        el.right.addEventListener('click', () => this.handlers.onMove(1));
        el.fps.min = String(kMinFps);
        el.fps.max = String(kMaxFps);
        el.fps.addEventListener('change', () => this.handlers.onFpsChange(el.fps.value));
        el.onion.addEventListener('change', () => this.handlers.onOnionChange(el.onion.checked));
    }

    // コマの数や並びが変わったときに作り直す
    render()
    {
        this.thumbnails = [];
        const items = [];
        for (let i = 0; i < this.frames.count; i++) items.push(this.createItem(i));
        this.el.list.replaceChildren(...items);
    }

    createItem(index)
    {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'frame-item';
        button.title = `コマ ${index + 1}`;
        const thumbnail = this.createThumbnailCanvas();
        const number = document.createElement('span');
        number.textContent = String(index + 1);
        button.append(thumbnail, number);
        button.addEventListener('click', () => this.handlers.onSelect(index));
        item.appendChild(button);
        this.thumbnails.push(thumbnail);
        return item;
    }

    createThumbnailCanvas()
    {
        const { width, height } = this.frames;
        const scale = kFrameThumbCss / Math.max(width, height);
        const cssWidth = Math.max(1, Math.round(width * scale));
        const cssHeight = Math.max(1, Math.round(height * scale));
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.className = 'frame-thumb';
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        return canvas;
    }

    // drawFn(ctx, frameIndex, width, height) で小さな絵を描かせる。indices を省くと全部
    drawThumbnails(drawFn, indices = null)
    {
        const targets = indices === null ? this.thumbnails.map((_, i) => i) : indices;
        for (const index of targets) {
            const canvas = this.thumbnails[index];
            if (canvas === undefined) continue;
            drawFn(canvas.getContext('2d'), index, canvas.width, canvas.height);
        }
    }

    // ボタンの使える・使えないと、今のコマの印を直す
    refresh(isPlaying)
    {
        const el = this.el;
        const frames = this.frames;
        const items = el.list.querySelectorAll('.frame-item');
        items.forEach((item, i) => item.classList.toggle('is-active', i === frames.currentIndex));
        items[frames.currentIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        el.label.textContent = `${frames.currentIndex + 1} / ${frames.count}`;
        el.play.textContent = isPlaying ? '■ 停止' : '▶ 再生';
        el.play.classList.toggle('is-playing', isPlaying);
        if (document.activeElement !== el.fps) el.fps.value = String(frames.fps);
        // 再生中にコマを足したり並べ替えたりすると、どのコマを触ったか分からなくなるので止める
        el.add.disabled = isPlaying;
        el.duplicate.disabled = isPlaying;
        el.remove.disabled = isPlaying || frames.count <= 1;
        el.left.disabled = isPlaying || frames.currentIndex <= 0;
        el.right.disabled = isPlaying || frames.currentIndex >= frames.count - 1;
        el.play.disabled = frames.count <= 1 && !isPlaying;
    }
}
