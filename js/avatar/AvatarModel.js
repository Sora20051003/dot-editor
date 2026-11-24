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
// 頭が回ったときに見せる奥行き（手前ほど向いた方へ大きくずれ、奥はずれが逆になる）。名前に含まれる言葉で決める
const kAvatarDepthFront = 0.7;
const kAvatarDepthFrontHair = 0.5;
const kAvatarDepthDefault = 0.3;
const kAvatarDepthBack = -0.3;
const kAvatarFrontWords = Object.freeze(['眼鏡', 'めがね', 'メガネ']);
const kAvatarFrontHairWords = Object.freeze(['前髪']);
const kAvatarBackWords = Object.freeze(['後ろ', 'うしろ']);

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
        const parts = [];
        let size = null;
        const sizeFor = (width, height) => {
            const scale = Math.min(1, kAvatarTextureSize / Math.max(width, height));
            return { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale), resizeQuality: 'high' };
        };
        // 1枚読むたびに縮めて、元の中身は手放す（8192 の 9 枚を同時に持つと 2GB を超えるため）。
        // 見るだけなので、エディタのメモリの上限では弾かない（メモリの少ない PC・Firefox・Safari でも開ける）
        const project = await ProjectFile.decode(blob, {
            isViewOnly: true,
            onLayer: async (info, frameIndex, header) => {
                if (frameIndex !== 0) return;
                const role = AvatarModel.roleOf(info.name);
                // 役目のあるレイヤーは、エディタで隠していても動きに使う（描くときに隠すことが多いため）
                const isPlainLayer = role === kAvatarHeadRole || role === 'body';
                if (isPlainLayer && !info.isVisible) return;
                size ??= sizeFor(header.width, header.height);
                const pixels = new Uint8ClampedArray(info.data.buffer, info.data.byteOffset, info.data.byteLength);
                const image = await createImageBitmap(new ImageData(pixels, header.width, header.height), size);
                parts.push({ name: info.name, role, depth: AvatarModel.depthOf(info.name, role), image, opacity: info.opacity });
            },
        });
        size ??= sizeFor(project.width, project.height);
        return new AvatarModel(parts, size.resizeWidth, size.resizeHeight);
    }

    static roleOf(name)
    {
        const normalized = name.trim().replace(/\s+/g, ' ');
        const found = Object.entries(kAvatarRoleNames).find(([, roleName]) => roleName === normalized);
        return found === undefined ? kAvatarHeadRole : found[0];
    }

    // 当てはまらない名前（ヘッドホン・顔など）は顔と同じ奥行きにする。名前を変えなければ今までの絵もそのまま動く
    static depthOf(name, role)
    {
        const has = (words) => words.some((word) => name.includes(word));
        if (role !== kAvatarHeadRole && role !== 'body') return kAvatarDepthFront;
        if (has(kAvatarFrontWords)) return kAvatarDepthFront;
        if (has(kAvatarFrontHairWords)) return kAvatarDepthFrontHair;
        if (has(kAvatarBackWords)) return kAvatarDepthBack;
        return kAvatarDepthDefault;
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
