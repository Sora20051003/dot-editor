'use strict';

const kHostPlayerId = 'p0';
const kMaxPlayers = 12;
const kMaxNameLength = 12;
const kLinkIdBytes = 8;

// ホストの通信。参加者ごとの PeerLink をまとめ、全員の間のやり取りを中継する。
// ホスト自身の画面も「参加者の1人」として、同じ形のメッセージで扱う
class HostSession
{
    // handlers: onJoin(id, name), onLeave(id), onAction(id, message), onLocalEvent(message), onStatus(text)
    constructor(handlers)
    {
        this.handlers = handlers;
        this.links = new Map();
        // 招待コードを渡したが、まだ返事コードが来ていないつながり（同時に1つだけ）
        this.openInvite = null;
        // 返事コードは受け取ったが、まだ名前を名乗っていないつながり
        this.connecting = new Set();
        this.nextPlayerNumber = 1;
    }

    get guestCount()
    {
        return this.links.size;
    }

    get canInvite()
    {
        return this.links.size + this.connecting.size < kMaxPlayers - 1;
    }

    // 前の招待コードに返事が来ていなければ、それは捨てて新しく作る
    async createInvite()
    {
        if (!this.canInvite) throw new Error(`これ以上は入れません（最大 ${kMaxPlayers} 人）`);
        if (this.openInvite !== null) this.openInvite.close();
        const link = this.createLink(HostSession.createLinkId());
        this.openInvite = link;
        return link.createOffer();
    }

    async acceptReply(code)
    {
        const info = await SignalCode.decode(code, SignalType.Answer);
        const link = this.openInvite;
        if (link === null || link.linkId !== info.linkId) {
            throw new Error('この返事コードに合う招待コードがありません。招待コードを作り直してください');
        }
        this.openInvite = null;
        this.connecting.add(link);
        await link.acceptAnswer(info.sdp);
    }

    createLink(linkId)
    {
        const state = { playerId: null };
        const link = new PeerLink(linkId, {
            onOpen: () => this.handlers.onStatus('つながりました。名前が届くのを待っています'),
            onMessage: (message) => this.onLinkMessage(link, state, message),
            onClose: () => this.onLinkClose(link, state),
        });
        return link;
    }

    // つながって最初のメッセージは必ず名乗り（hello）。それまでは他のメッセージを受け付けない
    onLinkMessage(link, state, message)
    {
        if (state.playerId !== null) {
            this.handlers.onAction(state.playerId, message);
            return;
        }
        if (message.t !== 'hello') return;
        state.playerId = `p${this.nextPlayerNumber++}`;
        this.connecting.delete(link);
        this.links.set(state.playerId, link);
        link.send({ t: 'welcome', myId: state.playerId });
        this.handlers.onJoin(state.playerId, HostSession.cleanName(message.name));
    }

    onLinkClose(link, state)
    {
        this.connecting.delete(link);
        if (this.openInvite === link) this.openInvite = null;
        if (state.playerId === null) return;
        this.links.delete(state.playerId);
        this.handlers.onLeave(state.playerId);
    }

    // 自分の画面への送信も、相手から届くのと同じく後から届くようにして順番をそろえる
    sendTo(playerId, message)
    {
        if (playerId === kHostPlayerId) {
            queueMicrotask(() => this.handlers.onLocalEvent(message));
            return;
        }
        const link = this.links.get(playerId);
        if (link !== undefined) link.send(message);
    }

    broadcast(message)
    {
        this.sendTo(kHostPlayerId, message);
        for (const link of this.links.values()) link.send(message);
    }

    // ホストの画面での操作
    sendFromLocal(message)
    {
        queueMicrotask(() => this.handlers.onAction(kHostPlayerId, message));
    }

    closeAll()
    {
        if (this.openInvite !== null) this.openInvite.close();
        for (const link of [...this.connecting, ...this.links.values()]) link.close();
    }

    static createLinkId()
    {
        const bytes = crypto.getRandomValues(new Uint8Array(kLinkIdBytes));
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    // 相手が送ってきた名前は信用しない。文字列にして長さを切り、空なら仮の名前にする
    static cleanName(name)
    {
        const text = typeof name === 'string' ? name.trim().slice(0, kMaxNameLength) : '';
        return text === '' ? 'ななしさん' : text;
    }
}
