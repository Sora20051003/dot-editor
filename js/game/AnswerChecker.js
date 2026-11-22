'use strict';

const kKatakanaStart = 0x30a1;
const kKatakanaEnd = 0x30f6;
// カタカナとひらがなの文字コードの差
const kKanaOffset = 0x60;
const kMaxAnswerLength = 30;

// 答え合わせ。ひらがな・カタカナ・全角半角・大文字小文字・空白と記号の違いは同じとみなす
const AnswerChecker = {
    normalize(text)
    {
        const folded = String(text).normalize('NFKC').toLowerCase();
        let result = '';
        for (const char of folded) {
            const code = char.codePointAt(0);
            const isKatakana = code >= kKatakanaStart && code <= kKatakanaEnd;
            result += isKatakana ? String.fromCodePoint(code - kKanaOffset) : char;
        }
        // 「ー」は言葉の一部なので残し、空白と区切りの記号だけ消す
        return result.replace(/[\s・、。,.!?！？「」『』"'()（）]/g, '');
    },

    isMatch(guess, answer)
    {
        const normalizedGuess = AnswerChecker.normalize(guess);
        return normalizedGuess !== '' && normalizedGuess === AnswerChecker.normalize(answer);
    },

    // 相手から届いた文字列を、長さを切ったきれいな1行にする。使えないものは空文字
    cleanText(text, maxLength = kMaxAnswerLength)
    {
        if (typeof text !== 'string') return '';
        return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
    },
};
