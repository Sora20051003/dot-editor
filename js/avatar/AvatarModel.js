'use strict';

// 表示用に縮めて持つ大きさ（長い辺）。4096 の絵を毎回そのまま描くと重いので、読むときに一度だけ縮める
const kAvatarTextureSize = 1024;

// レイヤーの名前で役目を決める。エディタでこの名前を付けておけば、アバターで動きに使われる
const kAvatarRoleNames = Object.freeze({
    eyesOpen: '目 開',
    eyesClosed: '目 閉',
    mouthOpen: '口 開',
    mouthClosed: '口 閉',
    body: '体',
});
// 名前が上のどれでもないレイヤーは、頭と一緒にゆれる
const kAvatarHeadRole = 'head';

// アバターの部品（作業ファイルの1コマ目のレイヤー）。下から順に並ぶ
class AvatarModel
{
    // parts: [{ name, role, image, opacity }]
    constructor(parts, width, height)
    {
        this.parts = parts;
        this.width = width;
        this.height = height;
    }

    // 作業ファイル（.dotart）から作る。読めないときは ProjectFile が理由付きで例外を投げる
    static async fromBlob(blob)
    {
        const project = await ProjectFile.decode(blob);
        const { width, height } = project;
        const scale = Math.min(1, kAvatarTextureSize / Math.max(width, height));
        const size = { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale), resizeQuality: 'high' };
        const parts = [];
        for (const info of project.frames[0].layers) {
            const role = AvatarModel.roleOf(info.name);
            // 役目のあるレイヤーは、エディタで隠していても動きに使う（描くときに隠すことが多いため）
            if (role === kAvatarHeadRole && !info.isVisible) continue;
            if (role === 'body' && !info.isVisible) continue;
            // 写しを作らずに、読み込んだ中身をそのまま絵にする（4096 だと1枚 64MB あるため）
            const pixels = new Uint8ClampedArray(info.data.buffer, info.data.byteOffset, info.data.byteLength);
            const image = await createImageBitmap(new ImageData(pixels, width, height), size);
            parts.push({ name: info.name, role, image, opacity: info.opacity });
        }
        return new AvatarModel(parts, size.resizeWidth, size.resizeHeight);
    }

    static roleOf(name)
    {
        const normalized = name.trim().replace(/\s+/g, ' ');
        const found = Object.entries(kAvatarRoleNames).find(([, roleName]) => roleName === normalized);
        return found === undefined ? kAvatarHeadRole : found[0];
    }

    hasRole(role)
    {
        return this.parts.some((part) => part.role === role);
    }

    // 動きに使う名前のうち、見つからなかったもの（画面で知らせる）
    get missingRoleNames()
    {
        const roles = ['eyesOpen', 'eyesClosed', 'mouthOpen', 'mouthClosed'];
        return roles.filter((role) => !this.hasRole(role)).map((role) => kAvatarRoleNames[role]);
    }
}
