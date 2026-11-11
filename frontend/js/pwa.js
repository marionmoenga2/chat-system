/**
 * Makes ChatWave installable: registers the service worker and shows a small
 * "Install" banner (Android and desktop Chrome), or a how-to hint on iPhones.
 */
(function () {
    'use strict';

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
        });
    }

    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    if (standalone) return;

    const KEY = 'pwa_prompt_dismissed_at';
    function recentlyDismissed() {
        return Date.now() - Number(localStorage.getItem(KEY) || 0) < 7 * 24 * 3600 * 1000;
    }

    const style = document.createElement('style');
    style.textContent = `
        .pwa-banner { position: fixed; left: 16px; bottom: 16px; z-index: 2100; width: 340px; max-width: calc(100vw - 32px);
            display: none; align-items: center; gap: 12px; padding: 12px 14px; background: #fff; color: #14213a;
            border: 1px solid #d5ddea; border-radius: 14px; box-shadow: 0 12px 32px -10px rgba(14,34,64,.4);
            font-family: 'Segoe UI', system-ui, sans-serif; font-size: .9rem; line-height: 1.4; }
        .pwa-banner.show { display: flex; }
        .pwa-banner img { width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0; }
        .pwa-banner strong { display: block; }
        .pwa-banner span { color: #5b6b82; font-size: .82rem; }
        .pwa-actions { display: flex; flex-direction: column; gap: 6px; margin-left: auto; }
        .pwa-btn { font: inherit; font-size: .82rem; font-weight: 600; padding: 7px 12px; border: 0; border-radius: 8px;
            background: #10b981; color: #04211a; cursor: pointer; }
        .pwa-btn.ghost { background: #eef2f9; color: #33425b; }
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.className = 'pwa-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install ChatWave');
    document.body.appendChild(banner);

    function hide() { banner.classList.remove('show'); }
    function dismiss() { localStorage.setItem(KEY, String(Date.now())); hide(); }

    let deferred = null;

    function show(kind) {
        const text = kind === 'ios'
            ? '<strong>Install ChatWave</strong><span>Tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</span>'
            : '<strong>Install ChatWave</strong><span>Add it to your home screen for quick access.</span>';
        banner.innerHTML = '<img src="icons/icon-192.png" alt="">' + '<div>' + text + '</div>'
            + '<div class="pwa-actions">'
            + (kind === 'ios' ? '' : '<button type="button" class="pwa-btn" id="pwa-install">Install</button>')
            + '<button type="button" class="pwa-btn ghost" id="pwa-later">' + (kind === 'ios' ? 'OK' : 'Not now') + '</button></div>';
        banner.classList.add('show');
        document.getElementById('pwa-later').addEventListener('click', dismiss);
        const btn = document.getElementById('pwa-install');
        if (btn) btn.addEventListener('click', function () {
            if (!deferred) return;
            deferred.prompt();
            deferred.userChoice.then(function () { deferred = null; hide(); });
        });
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferred = e;
        if (!recentlyDismissed()) show('install');
    });
    window.addEventListener('appinstalled', hide);

    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (isIos && isSafari && !recentlyDismissed()) setTimeout(function () { show('ios'); }, 3000);
})();
