'use strict';

// お互いのネット上の住所を調べるためだけに使う。絵や回答はここを通らない
const kIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
// 候補集めが終わらない環境でも、待たせすぎないように打ち切る
const kIceGatherTimeoutMs = 5000;
// Chrome の DataChannel で1回に送れる大きさの目安。超える受信は相手の不具合とみなして捨てる
const kMaxMessageChars = 256 * 1024;
const kChannelLabel = 'game';

// 1人の相手との直接のつながり（RTCPeerConnection と DataChannel）。中身は JSON で送る
class PeerLink
{
    // handlers: onOpen(), onMessage(object), onClose()
    constructor(linkId, handlers)
    {
        this.linkId = linkId;
        this.handlers = handlers;
        this.channel = null;
        this.isClosed = false;
        this.connection = new RTCPeerConnection({ iceServers: kIceServers });
        this.connection.addEventListener('connectionstatechange', () => {
            const state = this.connection.connectionState;
            if (state === 'failed' || state === 'closed') this.close();
        });
    }

    get isOpen()
    {
        return this.channel !== null && this.channel.readyState === 'open';
    }

    // ホスト側：招待コードを作る
    async createOffer()
    {
        this.bindChannel(this.connection.createDataChannel(kChannelLabel, { ordered: true }));
        await this.connection.setLocalDescription(await this.connection.createOffer());
        await this.waitIceGathering();
        return SignalCode.encode(SignalType.Offer, this.linkId, this.connection.localDescription.sdp);
    }

    // 参加する側：招待コードの中身を受け取り、返事コードを作る
    async acceptOffer(sdp)
    {
        this.connection.addEventListener('datachannel', (e) => this.bindChannel(e.channel));
        await this.connection.setRemoteDescription({ type: SignalType.Offer, sdp });
        await this.connection.setLocalDescription(await this.connection.createAnswer());
        await this.waitIceGathering();
        return SignalCode.encode(SignalType.Answer, this.linkId, this.connection.localDescription.sdp);
    }

    // ホスト側：返事コードの中身を受け取る。あとは自動でつながる
    async acceptAnswer(sdp)
    {
        await this.connection.setRemoteDescription({ type: SignalType.Answer, sdp });
    }

    // コードを1回渡すだけで済むように、住所の候補を全部集め終えてからコードにする
    waitIceGathering()
    {
        if (this.connection.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, kIceGatherTimeoutMs);
            this.connection.addEventListener('icegatheringstatechange', () => {
                if (this.connection.iceGatheringState !== 'complete') return;
                clearTimeout(timer);
                resolve();
            });
        });
    }

    bindChannel(channel)
    {
        this.channel = channel;
        channel.addEventListener('open', () => this.handlers.onOpen());
        channel.addEventListener('close', () => this.close());
        channel.addEventListener('message', (e) => this.receive(e.data));
    }

    receive(data)
    {
        if (typeof data !== 'string' || data.length > kMaxMessageChars) return;
        let message;
        try {
            message = JSON.parse(data);
        } catch (error) {
            return;
        }
        if (message !== null && typeof message === 'object') this.handlers.onMessage(message);
    }

    send(message)
    {
        if (!this.isOpen) return;
        const text = JSON.stringify(message);
        if (text.length > kMaxMessageChars) {
            console.warn(`PeerLink.send: 大きすぎるので送りません type=${message.t} chars=${text.length}`);
            return;
        }
        this.channel.send(text);
    }

    // 何度呼ばれても onClose は1回だけ知らせる
    close()
    {
        if (this.isClosed) return;
        this.isClosed = true;
        if (this.channel !== null) this.channel.close();
        this.connection.close();
        this.handlers.onClose();
    }
}
