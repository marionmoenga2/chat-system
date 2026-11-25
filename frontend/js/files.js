/**
 * Send photos and files in private chats and groups.
 * Loads after chat.js, groups.js and voice.js. Needs API_URL (config.js).
 * A file is sent as a normal message (::file:ID:KIND:SIZE:NAME::) and drawn as a picture or a file tile.
 */
(function () {
    'use strict';

    const MAX_FILE = 3000000;
    const MAX_IMAGE = 800000;
    const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    const DOC_EXT = ['pdf', 'txt', 'csv', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'zip'];
    const MARK = /^::file:(\d+):(image|file):(\d+):([^:]*)::$/;
    const MARK_ANY = /::file:\d+:(?:image|file):\d+:[^:]*::/g;
    const $ = (id) => document.getElementById(id);
    const blobUrls = {};
    let sending = false;

    const CLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

    const style = document.createElement('style');
    style.textContent = `
        .fx-clip { flex-shrink: 0; width: 44px; height: 44px; margin-left: 8px; border: 0; border-radius: 50%; background: #eef2f9;
            color: #33425b; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .fx-clip:hover { background: #dde6f5; }
        .fx-clip:disabled { opacity: .5; cursor: wait; }
        .fx-clip svg { width: 22px; height: 22px; }
        .fx-img { display: block; width: 220px; max-width: 100%; min-height: 70px; border-radius: 10px; overflow: hidden;
            background: rgba(127,140,160,.25); cursor: pointer; }
        .fx-img img { display: block; width: 100%; height: auto; max-height: 320px; object-fit: cover; }
        .fx-wait { padding: 26px 12px; text-align: center; font-size: .85rem; opacity: .8; }
        .fx-file { display: flex; align-items: center; gap: 10px; min-width: 200px; max-width: 300px; padding: 8px 10px;
            border-radius: 10px; background: rgba(127,140,160,.2); }
        .fx-ext { flex-shrink: 0; width: 40px; height: 40px; border-radius: 8px; background: #1f4fd8; color: #fff;
            font-size: .7rem; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .fx-meta { flex: 1; min-width: 0; }
        .fx-name { font-weight: 600; font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fx-size { font-size: .78rem; opacity: .8; }
        .fx-dl { flex-shrink: 0; border: 0; border-radius: 8px; padding: 6px 10px; font: inherit; font-size: .8rem;
            font-weight: 600; background: #1f4fd8; color: #fff; cursor: pointer; }
        .message.sent .fx-ext, .message.sent .fx-dl { background: #fff; color: #1f4fd8; }
        .fx-box { position: fixed; inset: 0; z-index: 4000; display: none; align-items: center; justify-content: center;
            flex-direction: column; gap: 12px; padding: 16px; background: rgba(0,0,0,.85); }
        .fx-box.open { display: flex; }
        .fx-box img { max-width: 100%; max-height: 80vh; border-radius: 8px; }
        .fx-box-actions { display: flex; gap: 10px; }
        .fx-box-actions button { font: inherit; font-weight: 600; padding: 8px 16px; border: 0; border-radius: 8px; cursor: pointer; }
    `;
    document.head.appendChild(style);

    function notify(m) { if (typeof showNotification === 'function') showNotification(m); }
    function token() { return localStorage.getItem('token'); }
    function fmtSize(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return Math.round(n / 1024) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }
    function safeName(encoded) {
        try { return decodeURIComponent(encoded) || 'file'; } catch (e) { return 'file'; }
    }

    async function request(method, path, body) {
        const t = token();
        if (!t || typeof API_URL === 'undefined') return { ok: false, status: 0, data: null };
        try {
            const res = await fetch(API_URL + path, {
                method: method,
                headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            });
            let data = null;
            try { data = await res.json(); } catch (e) { /* no body */ }
            return { ok: res.ok, status: res.status, data: data };
        } catch (e) {
            return { ok: false, status: 0, data: null };
        }
    }

    // ---------- Sending ----------

    function currentTarget() {
        const gid = (typeof window.getSelectedGroupId === 'function') ? window.getSelectedGroupId() : null;
        if (gid !== null && gid !== undefined) return { group_id: gid };
        if (typeof selectedUserId !== 'undefined' && selectedUserId) return { to_user_id: selectedUserId };
        return null;
    }

    function sameTarget(a, b) {
        return !!a && !!b && a.group_id === b.group_id && a.to_user_id === b.to_user_id;
    }

    function toBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onerror = function () { reject(new Error('read failed')); };
            reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
            reader.readAsDataURL(blob);
        });
    }

    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
            img.src = url;
        });
    }

    function toJpeg(img, maxSide, quality) {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';          // so transparent PNGs do not turn black
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
    }

    // Shrink photos on the sender's phone: saves data and storage
    async function prepareImage(file) {
        const img = await loadImage(file);
        const steps = [[1280, 0.82], [1024, 0.7], [800, 0.6]];
        for (let i = 0; i < steps.length; i++) {
            const blob = await toJpeg(img, steps[i][0], steps[i][1]);
            if (blob && blob.size <= MAX_IMAGE) return blob;
        }
        return null;
    }

    async function onPick(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file || sending) return;

        const target = currentTarget();
        if (!target) { notify('Open a chat first'); return; }
        if (!ws || ws.readyState !== WebSocket.OPEN) { notify('Not connected yet. Try again in a moment.'); return; }

        const original = (file.name || 'file').slice(-80);
        const ext = original.indexOf('.') > -1 ? original.split('.').pop().toLowerCase() : '';
        const isImage = IMG_EXT.indexOf(ext) > -1;
        if (!isImage && DOC_EXT.indexOf(ext) === -1) {
            notify('That file type is not allowed. You can send photos, PDFs, Office documents, text and zip files.');
            return;
        }

        sending = true;
        $('fx-clip').disabled = true;
        notify('Sending...');
        try {
            let blob = file;
            let name = original;
            if (isImage && ext !== 'gif') {
                blob = await prepareImage(file);
                if (!blob) { notify('That photo is too large'); return; }
                name = original.replace(/\.[^.]*$/, '') + '.jpg';
            } else if (file.size > (isImage ? MAX_IMAGE : MAX_FILE)) {
                notify('That file is too big. The limit is ' + (isImage ? '0.8' : '3') + ' MB.');
                return;
            }

            const body = { data: await toBase64(blob), name: name };
            Object.assign(body, target);
            const res = await request('POST', '/api/files', body);
            if (!res.ok || !res.data || !res.data.id) {
                const d = res.data && res.data.detail;
                notify(typeof d === 'string' ? d : 'Could not send the file');
                return;
            }
            if (!sameTarget(currentTarget(), target)) { notify('You switched chats, so the file was not sent'); return; }
            if (!ws || ws.readyState !== WebSocket.OPEN) { notify('Connection lost. The file was not sent.'); return; }

            const input = $('message-input');
            const previous = input.value;
            input.value = '::file:' + res.data.id + ':' + res.data.kind + ':' + res.data.size + ':'
                + encodeURIComponent(res.data.name || name) + '::';
            if (typeof sendMessage === 'function') sendMessage();
            input.value = previous;
        } catch (err) {
            notify(isImage ? 'Could not read that photo' : 'Could not send the file');
        } finally {
            sending = false;
            $('fx-clip').disabled = false;
        }
    }

    // ---------- Showing ----------

    async function getUrl(id) {
        if (blobUrls[id]) return blobUrls[id];
        const t = token();
        if (!t) return null;
        try {
            const res = await fetch(API_URL + '/api/files/' + id, { headers: { 'Authorization': 'Bearer ' + t } });
            if (!res.ok) return res.status === 404 ? 'gone' : null;
            blobUrls[id] = URL.createObjectURL(await res.blob());
            return blobUrls[id];
        } catch (e) {
            return null;
        }
    }

    async function download(id, name) {
        const url = await getUrl(id);
        if (!url || url === 'gone') { notify(url === 'gone' ? 'That file has expired' : 'Could not download the file'); return; }
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function openBox(id, name) {
        getUrl(id).then(function (url) {
            if (!url || url === 'gone') return;
            $('fx-box-img').src = url;
            $('fx-box-img').alt = name;
            $('fx-box').dataset.id = id;
            $('fx-box').dataset.name = name;
            $('fx-box').classList.add('open');
        });
    }

    function closeBox() {
        $('fx-box').classList.remove('open');
        $('fx-box-img').removeAttribute('src');
    }

    function buildImage(id, name) {
        const el = document.createElement('div');
        el.className = 'fx-img';
        el.dataset.id = id;
        el.dataset.name = name;
        el.innerHTML = '<div class="fx-wait">Loading photo...</div>';
        getUrl(id).then(function (url) {
            if (!url || url === 'gone') {
                el.querySelector('.fx-wait').textContent = url === 'gone' ? 'Photo expired' : 'Could not load photo';
                el.style.cursor = 'default';
                return;
            }
            el.innerHTML = '';
            const img = document.createElement('img');
            img.alt = name;
            img.addEventListener('load', function () {
                const c = $('messages-container');
                if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 500) c.scrollTop = c.scrollHeight;
            });
            img.src = url;
            el.appendChild(img);
            el.dataset.ready = '1';
        });
        el.addEventListener('click', function () { if (el.dataset.ready) openBox(id, name); });
        return el;
    }

    function buildFile(id, size, name) {
        const ext = name.indexOf('.') > -1 ? name.split('.').pop().slice(0, 4).toUpperCase() : 'FILE';
        const el = document.createElement('div');
        el.className = 'fx-file';
        el.innerHTML = '<div class="fx-ext"></div><div class="fx-meta"><div class="fx-name"></div><div class="fx-size"></div></div>'
            + '<button type="button" class="fx-dl" aria-label="Download file">Download</button>';
        el.querySelector('.fx-ext').textContent = ext;
        el.querySelector('.fx-name').textContent = name;
        el.querySelector('.fx-size').textContent = fmtSize(size);
        el.querySelector('.fx-dl').addEventListener('click', function () { download(id, name); });
        return el;
    }

    // ---------- Turn file messages into pictures and tiles ----------

    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        const all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
        all.forEach(function (el) {
            if (el.childElementCount) return;
            const t = el.textContent;
            if (t.indexOf('::file:') === -1) return;
            const m = MARK.exec(t.trim());
            const preview = el.closest('.reply-quote, #reply-bar, .user-item');
            if (m && !preview) {
                const name = safeName(m[4]);
                el.textContent = '';
                el.appendChild(m[2] === 'image' ? buildImage(m[1], name) : buildFile(m[1], Number(m[3]), name));
            } else if (preview) {
                el.textContent = t.replace(MARK_ANY, function (found) {
                    const p = MARK.exec(found);
                    return p && p[2] === 'image' ? 'Photo' : 'File: ' + (p ? safeName(p[4]) : '');
                });
            }
        });
    }

    function build() {
        const input = $('message-input');
        if (!input) return false;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fx-clip';
        btn.id = 'fx-clip';
        btn.title = 'Send a photo or file';
        btn.setAttribute('aria-label', 'Send a photo or file');
        btn.innerHTML = CLIP;
        input.insertAdjacentElement('afterend', btn);

        const picker = document.createElement('input');
        picker.type = 'file';
        picker.id = 'fx-picker';
        picker.hidden = true;
        picker.accept = 'image/*,' + DOC_EXT.map(function (x) { return '.' + x; }).join(',');
        document.body.appendChild(picker);
        btn.addEventListener('click', function () { picker.click(); });
        picker.addEventListener('change', onPick);

        document.body.insertAdjacentHTML('beforeend',
            '<div class="fx-box" id="fx-box" role="dialog" aria-modal="true" aria-label="Photo">'
            + '<img id="fx-box-img" alt="">'
            + '<div class="fx-box-actions"><button type="button" id="fx-box-dl">Download</button>'
            + '<button type="button" id="fx-box-close">Close</button></div></div>');
        $('fx-box-close').addEventListener('click', closeBox);
        $('fx-box-dl').addEventListener('click', function () { download($('fx-box').dataset.id, $('fx-box').dataset.name); });
        $('fx-box').addEventListener('click', function (e) { if (e.target.id === 'fx-box') closeBox(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBox(); });
        return true;
    }

    function init() {
        if (!token() || !build()) return;
        new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (n) { scan(n.nodeType === 1 ? n : n.parentElement); });
            });
        }).observe(document.body, { childList: true, subtree: true });
        scan(document.body);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
