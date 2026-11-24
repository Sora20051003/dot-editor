'use strict';

// ZIP の決まった数（PKWARE の仕様）
const kZipLocalSignature = 0x04034b50;
const kZipCentralSignature = 0x02014b50;
const kZipEndSignature = 0x06054b50;
const kZipVersion = 20;
// ファイル名を UTF-8 で書いたという印。日本語のファイル名が化けないように
const kZipUtf8Flag = 0x0800;
const kZipLocalHeaderBytes = 30;
const kZipCentralHeaderBytes = 46;
const kZipEndBytes = 22;
const kCrcPolynomial = 0xedb88320;
// ZIP の日時は DOS 形式で、1980年より前は書けない
const kZipDosEpochYear = 1980;

// コマごとの PNG を1つにまとめるための、圧縮しない ZIP。
// PNG はもう圧縮されているので縮める意味がなく、外部の部品も要らない。
// ブラウザは何十個もの別々のダウンロードを止めてしまうので、1つのファイルにする
class ZipWriter
{
    constructor()
    {
        this.entries = [];
        this.dosDateTime = ZipWriter.toDosDateTime(new Date());
    }

    // 展開したファイルの日時が保存した日時になるように入れる。
    // DOS 形式：日付 (年-1980)<<9 | 月<<5 | 日、時刻 時<<11 | 分<<5 | 秒/2
    static toDosDateTime(date)
    {
        const year = Math.max(kZipDosEpochYear, date.getFullYear());
        return {
            date: ((year - kZipDosEpochYear) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
            time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        };
    }

    // bytes は Uint8Array
    add(fileName, bytes)
    {
        this.entries.push({ name: new TextEncoder().encode(fileName), bytes, crc: ZipWriter.crc32(bytes) });
    }

    toBlob()
    {
        const parts = [];
        const centralParts = [];
        let offset = 0;
        for (const entry of this.entries) {
            const local = ZipWriter.createHeader(entry, kZipLocalHeaderBytes, 0, this.dosDateTime);
            parts.push(local, entry.name, entry.bytes);
            centralParts.push(ZipWriter.createHeader(entry, kZipCentralHeaderBytes, offset, this.dosDateTime), entry.name);
            offset += local.length + entry.name.length + entry.bytes.length;
        }
        const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
        parts.push(...centralParts, this.createEnd(centralSize, offset));
        return new Blob(parts, { type: 'application/zip' });
    }

    // 中のファイルの前に置く見出し（local）と、最後の目次に置く見出し（central）は、ほぼ同じ並び
    static createHeader(entry, size, localOffset, dosDateTime)
    {
        const header = new Uint8Array(size);
        const view = new DataView(header.buffer);
        const isCentral = size === kZipCentralHeaderBytes;
        // central には「作った版」の欄が1つ多いので、そのあとの位置が 2 バイトずれる
        const shift = isCentral ? 2 : 0;
        view.setUint32(0, isCentral ? kZipCentralSignature : kZipLocalSignature, true);
        if (isCentral) view.setUint16(4, kZipVersion, true);
        view.setUint16(4 + shift, kZipVersion, true);
        view.setUint16(6 + shift, kZipUtf8Flag, true);
        // 8+shift：圧縮しない（0 のまま）
        view.setUint16(10 + shift, dosDateTime.time, true);
        view.setUint16(12 + shift, dosDateTime.date, true);
        view.setUint32(14 + shift, entry.crc, true);
        view.setUint32(18 + shift, entry.bytes.length, true);
        view.setUint32(22 + shift, entry.bytes.length, true);
        view.setUint16(26 + shift, entry.name.length, true);
        if (isCentral) view.setUint32(42, localOffset, true);
        return header;
    }

    createEnd(centralSize, centralOffset)
    {
        const end = new Uint8Array(kZipEndBytes);
        const view = new DataView(end.buffer);
        view.setUint32(0, kZipEndSignature, true);
        view.setUint16(8, this.entries.length, true);
        view.setUint16(10, this.entries.length, true);
        view.setUint32(12, centralSize, true);
        view.setUint32(16, centralOffset, true);
        return end;
    }

    static crc32(bytes)
    {
        const table = ZipWriter.crcTable();
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    static crcTable()
    {
        if (ZipWriter.table) return ZipWriter.table;
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? kCrcPolynomial ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        ZipWriter.table = table;
        return table;
    }
}
