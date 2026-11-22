'use strict';

// 招待コード・返事コードの先頭。違うものを貼られたときにすぐ気付けるようにする
const kSignalPrefix = 'DOTNET1:';
const SignalType = Object.freeze({ Offer: 'offer', Answer: 'answer' });

// つなぐための情報（WebRTC の SDP）を、LINE などに貼れる1行の文字列にする
const SignalCode = {
    async encode(type, linkId, sdp)
    {
        const json = JSON.stringify({ type, linkId, sdp });
        const bytes = new TextEncoder().encode(json);
        return kSignalPrefix + (await ByteCodec.gzipToBase64(bytes));
    },

    // 貼り付けたときに入りがちな空白・改行は無視する。読めなければ日本語の説明付きで例外を投げる
    async decode(text, expectedType)
    {
        const compact = String(text).replace(/\s+/g, '');
        if (!compact.startsWith(kSignalPrefix)) throw new Error('コードの形が違います。全部コピーできているか確かめてください');
        let info;
        try {
            const bytes = await ByteCodec.base64ToGunzip(compact.slice(kSignalPrefix.length));
            info = JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) {
            throw new Error('コードが途中で切れているか、壊れています');
        }
        if (info === null || typeof info.sdp !== 'string' || typeof info.linkId !== 'string') {
            throw new Error('コードの中身が足りません');
        }
        if (info.type !== expectedType) {
            const expectedName = expectedType === SignalType.Offer ? '招待コード' : '返事コード';
            throw new Error(`これは${expectedName}ではありません`);
        }
        return info;
    },
};
