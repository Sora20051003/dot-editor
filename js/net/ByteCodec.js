'use strict';

// btoa に一度に大きな文字列を渡すと引数の数の上限を超えるので、区切って文字にする
const kBase64ChunkBytes = 0x8000;

// バイト列を gzip して base64 文字列にする（接続コードと絵の送受信で使う）
const ByteCodec = {
    async gzipToBase64(bytes)
    {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
        const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
        return ByteCodec.toBase64(compressed);
    },

    // 壊れた文字列なら例外を投げる（呼ぶ側で日本語の説明に直す）
    async base64ToGunzip(text)
    {
        const compressed = ByteCodec.fromBase64(text);
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    },

    toBase64(bytes)
    {
        let binary = '';
        for (let i = 0; i < bytes.length; i += kBase64ChunkBytes) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + kBase64ChunkBytes));
        }
        return btoa(binary);
    },

    fromBase64(text)
    {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    },
};
