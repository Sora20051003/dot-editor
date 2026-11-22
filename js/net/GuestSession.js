'use strict';

// 参加する側の通信。ホストとだけつながる
class GuestSession
{
    // handlers: onEvent(message), onOpen(), onClose()
    constructor(name, handlers)
    {
        this.name = name;
        this.handlers = handlers;
        this.link = null;
    }

    // 招待コードから返事コードを作る。作り直したときは前のつながりを捨てる
    async createReply(code)
    {
        const info = await SignalCode.decode(code, SignalType.Offer);
        // 先に外してから閉じる（作り直しを「切れた」と知らせないため）
        const oldLink = this.link;
        this.link = null;
        if (oldLink !== null) oldLink.close();
        const link = new PeerLink(info.linkId, {
            onOpen: () => {
                link.send({ t: 'hello', name: this.name });
                this.handlers.onOpen();
            },
            onMessage: (message) => this.handlers.onEvent(message),
            onClose: () => {
                if (this.link === link) this.handlers.onClose();
            },
        });
        this.link = link;
        return link.acceptOffer(info.sdp);
    }

    send(message)
    {
        if (this.link !== null) this.link.send(message);
    }

    close()
    {
        if (this.link !== null) this.link.close();
    }
}
