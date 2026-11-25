/**
 * Voice notes: record and send a voice note in private chats and groups.
 * Loads after chat.js and groups.js. Needs API_URL (config.js).
 * A voice note is sent as a normal message (::voice:ID:SECONDS::) and drawn as a player.
 */
(function () {
    'use strict';

    const MAX_SECONDS = 120;
    const MARK = /^::voice:(\d+):(\d+)::$/;
    const $ = (id) => document.getElementById(id);
    const blobUrls = {};
    let rec = null;
    let playing = null;
    let sending = false;

    const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

    const style = document.createElement('style');
    style.textContent = `
        .vn-mic { flex-shrink: 0; width: 44px; height: 44px; margin-left: 8px; border: 0; border-radius: 50%; background: #eef2f9;
            color: #33425b; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .vn-mic:hover { background: #dde6f5; }
        .vn-mic:disabled { opacity: .5; cursor: wait; }
        .vn-mic svg { width: 22px; height: 22px; }
        .vn-bar { display: none; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 8px; border-radius: 12px; background: #fdecea; color: #7a1f16; }
        .vn-bar.show { display: flex; }
        .vn-dot { width: 10px; height: 10px; border-radius: 50%; background: #e11d48; animation: vn-pulse 1s infinite; }
        @keyframes vn-pulse { 50% { opacity: .3; } }
        .vn-time { font-variant-numeric: tabular-nums; font-weight: 700; }
        .vn-hint { flex: 1; font-size: .85rem; }
        .vn-bar button { font: inherit; font-size: .85rem; font-weight: 600; padding: 7px 14px; border: 0; border-radius: 8px; cursor: pointer; }
        .vn-cancel { background: #fff; color: #7a1f16; }
        .vn-send { background: #1f4fd8; color: #fff; }
        .vn-player { display: flex; align-items: center; gap: 10px; min-width: 210px; max-width: 280px; }
        .vn-play { flex-shrink: 0; width: 36px; height: 36px; border: 0; border-radius: 50%; background: #1f4fd8; color: #fff; cursor: pointer; font-size: .8rem; line-height: 1; }
        .vn-track { flex: 1; height: 6px; border-radius: 6px; background: rgba(127,140,160,.35); cursor: pointer; overflow: hidden; }
        .vn-fill { height: 100%; width: 0; background: #1f4fd8; }
        .vn-dur { font-size: .8rem; font-variant-numeric: tabular-nums; opacity: .85; min-width: 40px; text-align: right; }
        .message.sent .vn-play { background: #fff; color: #1f4fd8; }
        .message.sent .vn-track { background: rgba(255,255,255,.35); }
        .message.sent .vn-fill { background: #fff; }
    `;
    document.head.appendChild(style);

    function notify(m) { if (typeof showNotification === 'function') showNotification(m); }
    function token() { return localStorage.getItem('token'); }
    function fmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

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

    // ---------- Recording ----------

    function currentTarget() {
        const gid = (typeof window.getSelectedGroupId === 'function') ? window.getSelectedGroupId() : null;
        if (gid !== null && gid !== undefined) return { group_id: gid };
        if (typeof selectedUserId !== 'undefined' && selectedUserId) return { to_user_id: selectedUserId };
        return null;
    }

    function sameTarget(a, b) {
        return !!a && !!b && a.group_id === b.group_id && a.to_user_id === b.to_user_id;
    }

    function pickMime() {
        const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        for (let i = 0; i < list.length; i++) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i])) return list[i];
        }
        return '';
    }

    async function startRecording() {
        if (rec || sending) return;
        if (!navigator.mediaDevices || !window.MediaRecorder) { notify('Voice notes are not supported in this browser'); return; }
        const target = currentTarget();
        if (!target) { notify('Open a chat first'); return; }
        if (!ws || ws.readyState !== WebSocket.OPEN) { notify('Not connected yet. Try again in a moment.'); return; }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch (e) {
            notify('Allow microphone access to record a voice note');
            return;
        }
        const mime = pickMime();
        const recorder = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 }) : new MediaRecorder(stream);
        const r = { stream: stream, recorder: recorder, chunks: [], start: Date.now(), timer: null, send: false, target: target };
        rec = r;
        recorder.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
        recorder.onstop = () => onStopped(r);
        recorder.start(250);

        $('vn-bar').classList.add('show');
        $('vn-time').textContent = '0:00';
        r.timer = setInterval(function () {
            const s = (Date.now() - r.start) / 1000;
            $('vn-time').textContent = fmt(s);
            if (s >= MAX_SECONDS) stopRecording(true);
        }, 250);
    }

    function stopRecording(send) {
        if (!rec) return;
        rec.send = send;
        clearInterval(rec.timer);
        try { rec.recorder.stop(); } catch (e) { onStopped(rec); }
    }

    function toBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onerror = function () { reject(new Error('read failed')); };
            reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
            reader.readAsDataURL(blob);
        });
    }

    async function onStopped(r) {
        r.stream.getTracks().forEach(function (t) { t.stop(); });
        $('vn-bar').classList.remove('show');
        if (rec === r) rec = null;
        if (!r.send || !r.chunks.length) return;

        const seconds = Math.max(1, Math.round((Date.now() - r.start) / 1000));
        const blob = new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' });
        if (blob.size < 800) { notify('That recording was empty'); return; }

        sending = true;
        $('vn-mic').disabled = true;
        try {
            const body = { audio: await toBase64(blob), mime: blob.type.split(';')[0], seconds: seconds };
            Object.assign(body, r.target);
            const res = await request('POST', '/api/voice', body);
            if (!res.ok || !res.data || !res.data.id) {
                const d = res.data && res.data.detail;
                notify(typeof d === 'string' ? d : 'Could not send the voice note');
                return;
            }
            if (!sameTarget(currentTarget(), r.target)) { notify('You switched chats, so the voice note was not sent'); return; }
            if (!ws || ws.readyState !== WebSocket.OPEN) { notify('Connection lost. The voice note was not sent.'); return; }

            const input = $('message-input');
            const previous = input.value;
            input.value = '::voice:' + res.data.id + ':' + res.data.seconds + '::';
            if (typeof sendMessage === 'function') sendMessage();
            input.value = previous;
        } catch (e) {
            notify('Could not send the voice note');
        } finally {
            sending = false;
            $('vn-mic').disabled = false;
        }
    }

    // ---------- Playing ----------

    async function getUrl(id) {
        if (blobUrls[id]) return blobUrls[id];
        const t = token();
        if (!t) return null;
        try {
            const res = await fetch(API_URL + '/api/voice/' + id, { headers: { 'Authorization': 'Bearer ' + t } });
            if (!res.ok) return res.status === 404 ? 'gone' : null;
            blobUrls[id] = URL.createObjectURL(await res.blob());
            return blobUrls[id];
        } catch (e) {
            return null;
        }
    }

    function resetPlayer(p) {
        p.querySelector('.vn-play').innerHTML = '&#9654;';
        p.querySelector('.vn-fill').style.width = '0';
        p.querySelector('.vn-dur').textContent = fmt(Number(p.dataset.sec));
    }

    function stopPlaying() {
        if (!playing) return;
        const cur = playing;
        playing = null;
        cur.audio.pause();
        resetPlayer(cur.player);
    }

    async function toggle(p) {
        if (playing && playing.player === p) {
            if (playing.audio.paused) playing.audio.play(); else playing.audio.pause();
            return;
        }
        stopPlaying();
        const btn = p.querySelector('.vn-play');
        btn.textContent = '...';
        const url = await getUrl(p.dataset.id);
        if (!url || url === 'gone') {
            btn.innerHTML = '&#9654;';
            p.querySelector('.vn-dur').textContent = url === 'gone' ? 'Expired' : 'Error';
            return;
        }
        const audio = new Audio(url);
        playing = { audio: audio, player: p };
        audio.addEventListener('play', function () { btn.innerHTML = '&#10074;&#10074;'; });
        audio.addEventListener('pause', function () { btn.innerHTML = '&#9654;'; });
        audio.addEventListener('timeupdate', function () {
            const total = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : Number(p.dataset.sec);
            p.querySelector('.vn-fill').style.width = Math.min(100, (audio.currentTime / total) * 100) + '%';
            p.querySelector('.vn-dur').textContent = fmt(total - audio.currentTime);
        });
        audio.addEventListener('ended', function () { resetPlayer(p); if (playing && playing.player === p) playing = null; });
        audio.play().catch(function () { resetPlayer(p); playing = null; notify('Could not play the voice note'); });
    }

    function seek(p, e) {
        if (!playing || playing.player !== p) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const a = playing.audio;
        const total = (isFinite(a.duration) && a.duration > 0) ? a.duration : Number(p.dataset.sec);
        a.currentTime = ratio * total;
    }

    function buildPlayer(id, seconds) {
        const el = document.createElement('div');
        el.className = 'vn-player';
        el.dataset.id = id;
        el.dataset.sec = seconds;
        el.innerHTML = '<button type="button" class="vn-play" aria-label="Play voice note">&#9654;</button>'
            + '<div class="vn-track"><div class="vn-fill"></div></div><span class="vn-dur">' + fmt(seconds) + '</span>';
        el.querySelector('.vn-play').addEventListener('click', function () { toggle(el); });
        el.querySelector('.vn-track').addEventListener('click', function (e) { seek(el, e); });
        return el;
    }

    // ---------- Turn voice-note messages into players ----------

    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        const all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
        all.forEach(function (el) {
            if (el.childElementCount) return;
            const t = el.textContent;
            if (t.indexOf('::voice:') === -1) return;
            const m = MARK.exec(t.trim());
            const preview = el.closest('.reply-quote, #reply-bar, .user-item');
            if (m && !preview) {
                el.textContent = '';
                el.appendChild(buildPlayer(m[1], Number(m[2])));
            } else if (preview) {
                el.textContent = t.replace(/::voice:\d+:\d+::/g, 'Voice note');
            }
        });
    }

    function build() {
        const input = $('message-input');
        const area = $('message-input-area');
        if (!input || !area) return false;

        const bar = document.createElement('div');
        bar.className = 'vn-bar';
        bar.id = 'vn-bar';
        bar.innerHTML = '<span class="vn-dot"></span><span class="vn-time" id="vn-time">0:00</span>'
            + '<span class="vn-hint">Recording...</span>'
            + '<button type="button" class="vn-cancel" id="vn-cancel">Cancel</button>'
            + '<button type="button" class="vn-send" id="vn-send">Send</button>';
        area.insertBefore(bar, area.firstChild);

        const mic = document.createElement('button');
        mic.type = 'button';
        mic.className = 'vn-mic';
        mic.id = 'vn-mic';
        mic.title = 'Record a voice note';
        mic.setAttribute('aria-label', 'Record a voice note');
        mic.innerHTML = MIC;
        input.insertAdjacentElement('afterend', mic);

        mic.addEventListener('click', startRecording);
        $('vn-cancel').addEventListener('click', function () { stopRecording(false); });
        $('vn-send').addEventListener('click', function () { stopRecording(true); });
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
