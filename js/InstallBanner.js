'use strict';

const kInstallDismissedKey = 'dotEditor.installBannerDismissed';
const kInstallExeHostName = 'dotapp.local';

// 公開版をブラウザのタブで開いたときだけ、上に「アプリとして入れる」の帯を出す。
// 一度入れておくと、Android とパソコンの Chrome / Edge ではリンクを踏んだときもアプリの窓で開く
// （manifest の handle_links）。iPhone はボタンで入れられないので手順を出す
class InstallBanner
{
    static start()
    {
        if (!InstallBanner.shouldOffer()) return;
        const banner = new InstallBanner();
        window.addEventListener('beforeinstallprompt', (e) => {
            // ブラウザが自分で出す小さな案内の代わりに、この帯のボタンから出す
            e.preventDefault();
            banner.showInstallButton(e);
        });
        window.addEventListener('appinstalled', () => banner.remove());
        if (InstallBanner.isIos()) banner.showIosSteps();
    }

    // exe 版・file://・もうアプリとして開いているとき・前に閉じたときは出さない
    static shouldOffer()
    {
        const isPublished = location.protocol === 'https:' && location.hostname !== kInstallExeHostName;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
        return isPublished && !isStandalone && !InstallBanner.wasDismissed();
    }

    static isIos()
    {
        const isIpadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        return /iPhone|iPad|iPod/.test(navigator.userAgent) || isIpadDesktopMode;
    }

    static wasDismissed()
    {
        try {
            return localStorage.getItem(kInstallDismissedKey) === '1';
        } catch (error) {
            return false;
        }
    }

    constructor()
    {
        this.element = null;
    }

    showInstallButton(promptEvent)
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'primary';
        button.textContent = 'アプリとして入れる';
        button.addEventListener('click', async () => {
            promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice.outcome === 'accepted') this.remove();
        });
        this.show('アプリとして入れると、リンクを開いたときも専用の窓で開きます。', button);
    }

    showIosSteps()
    {
        this.show('アプリとして使うには、Safari の共有ボタン（□に↑）→「ホーム画面に追加」。以後はホーム画面のアイコンから開いてください。', null);
    }

    show(text, actionButton)
    {
        this.remove();
        const element = document.createElement('div');
        element.className = 'install-banner';
        element.setAttribute('role', 'region');
        element.setAttribute('aria-label', 'アプリとして入れる');
        const message = document.createElement('span');
        message.textContent = text;
        element.appendChild(message);
        if (actionButton !== null) element.appendChild(actionButton);
        element.appendChild(this.createCloseButton());
        document.body.appendChild(element);
        this.element = element;
    }

    createCloseButton()
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'install-close';
        button.textContent = '閉じる';
        button.addEventListener('click', () => {
            try {
                localStorage.setItem(kInstallDismissedKey, '1');
            } catch (error) {
                // 覚えられなくても、今は閉じられればよい
            }
            this.remove();
        });
        return button;
    }

    remove()
    {
        if (this.element !== null) this.element.remove();
        this.element = null;
    }
}

InstallBanner.start();
