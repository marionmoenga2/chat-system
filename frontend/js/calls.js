/**
 * Voice and video calls (WebRTC): one-to-one, and group calls of up to 4 people where
 * everyone connects directly to everyone else. Anyone in a call can add more people.
 *
 * Plugs into chat.js (which must load first): it uses chat.js globals (ws, onlineSet,
 * users, currentUser) and wraps handleWebSocketMessage and selectUser. Call setup messages
 * travel over the existing chat WebSocket; the call itself goes directly between browsers.
 *
 * Optional: define CALL_ICE_SERVERS in config.js to add a TURN server.
 */
(function () {
    'use strict';

    const RING_TIMEOUT_MS = 45000;
    const JOIN_TIMEOUT_MS = 30000;
    const DISCONNECT_GRACE_MS = 12000;
    const ROSTER_GRACE_MS = 2500;
    const MAX_PARTICIPANTS = 4;   // including you

    const SVG = (inner, extra) =>
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${inner}</svg>`;

    const PHONE_PATH = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>';

    const ICONS = {
        phone: SVG(PHONE_PATH),
        hangup: SVG(PHONE_PATH, 'style="transform:rotate(135deg)"'),
        video: SVG('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
        videoOff: SVG('<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>'),
        mic: SVG('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
        micOff: SVG('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
        userPlus: SVG('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>')
    };

    /*
     * call = {
     *   id, video, state: 'calling' | 'connecting' | 'connected',
     *   localStream, muted, cameraOff,
     *   peers:   Map(userId -> peer),     people we have a connection with
     *   invites: Map(userId -> invite),   people we asked to join, not answered yet
     *   startedAt, timer, ringTimeout
     * }
     * peer = { id, name, pc, stream, connected, offering, cameraOff, pending[], dropTimer, statusText, tile }
     */
    let call = null;
    let incoming = null;   // a call or invitation waiting to be accepted or declined
    let starting = false;  // true while we wait for microphone / camera permission

    const $ = (id) => document.getElementById(id);

    // ---------- Helpers ----------

    function iceServers() {
        if (typeof CALL_ICE_SERVERS !== 'undefined' && Array.isArray(CALL_ICE_SERVERS) && CALL_ICE_SERVERS.length) {
            return CALL_ICE_SERVERS;
        }
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }

    function supportsCalls() {
        return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    function makeId() {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    function hasVideoTrack(stream) {
        return !!stream && stream.getVideoTracks().length > 0;
    }

    function nameOf(id) {
        if (id === currentUser.id) return currentUser.username;
        const u = users.find(x => x.id === id);
        return u ? u.username : 'Someone';
    }

    function wsSend(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    function formatDuration(total) {
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    function getMedia(video) {
        return navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
        });
    }

    function mediaErrorMessage(err, video) {
        const what = video ? 'microphone and camera' : 'microphone';
        switch (err && err.name) {
            case 'NotAllowedError':
            case 'SecurityError':
                return `Allow access to your ${what} in the browser, then try again.`;
            case 'NotFoundError':
            case 'OverconstrainedError':
                return `No ${what} was found on this device.`;
            case 'NotReadableError':
                return `Your ${what} is being used by another app.`;
            default:
                return 'Could not access your microphone or camera.';
        }
    }

    function closePc(pc) {
        if (!pc) return;
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        try { pc.close(); } catch (e) { /* already closed */ }
    }

    // Best-effort ringtone (some browsers block sound until you have interacted with the page)
    const Ringer = {
        ctx: null,
        timer: null,
        start() {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this.ctx = this.ctx || new AC();
                if (this.ctx.resume) this.ctx.resume();

                const beep = () => {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.frequency.value = 480;
                    gain.gain.value = 0.07;
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start();
                    osc.stop(this.ctx.currentTime + 0.45);
                };
                beep();
                this.timer = setInterval(beep, 1600);
                if (navigator.vibrate) navigator.vibrate([300, 200, 300]);
            } catch (e) { /* sound is optional */ }
        },
        stop() {
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            if (navigator.vibrate) navigator.vibrate(0);
        }
    };

    // ---------- Page setup ----------

    const STYLE = `
        .call-stage { background: radial-gradient(circle at 30% 20%, #312e81 0%, #0b1020 65%); }

        .call-grid {
            position: absolute;
            inset: 0;
            display: grid;
            grid-template-columns: 1fr;
            grid-auto-rows: minmax(0, 1fr);
            gap: 4px;
            padding: 4px;
        }
        .call-grid[data-count="3"], .call-grid[data-count="4"] { grid-template-columns: 1fr 1fr; }
        .call-grid[data-count="3"] .call-tile:nth-child(3) { grid-column: 1 / -1; }

        @media (orientation: landscape) and (min-width: 700px) {
            .call-grid[data-count="2"] { grid-template-columns: 1fr 1fr; }
            .call-grid[data-count="3"] { grid-template-columns: repeat(3, 1fr); }
            .call-grid[data-count="3"] .call-tile:nth-child(3) { grid-column: auto; }
        }

        .call-tile {
            position: relative;
            min-height: 0;
            overflow: hidden;
            border-radius: 14px;
            background: #111827;
            color: #fff;
        }

        .call-tile video {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0;
        }
        .call-tile.has-video video { opacity: 1; }

        .tile-avatar {
            position: absolute;
            top: 50%;
            left: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            width: clamp(64px, 30%, 112px);
            aspect-ratio: 1 / 1;
            transform: translate(-50%, -50%);
            border-radius: 50%;
            font-size: 2.4rem;
            font-weight: 800;
            box-shadow: 0 16px 32px -12px rgba(0, 0, 0, 0.6);
        }
        .tile-avatar img {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 50%;
        }
        .call-tile.has-video .tile-avatar { display: none; }

        .tile-name {
            position: absolute;
            left: 0.6rem;
            bottom: 0.55rem;
            max-width: calc(100% - 1.2rem);
            padding: 0.2rem 0.65rem;
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.5);
            font-size: 0.8rem;
            font-weight: 700;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tile-state {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 2.7rem;
            text-align: center;
            font-size: 0.82rem;
            opacity: 0.85;
            text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
        }
        .tile-state:empty { display: none; }

        .call-top {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            z-index: 3;
            padding: 0.9rem 130px 1.6rem 1rem;
            background: linear-gradient(rgba(0, 0, 0, 0.6), transparent);
            text-align: left;
            pointer-events: none;
        }
        .call-title { font-size: 1.05rem; font-weight: 800; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7); overflow-wrap: anywhere; }
        .call-top .call-status { margin-top: 0.15rem; font-size: 0.85rem; opacity: 0.9; }

        #local-video { z-index: 4; }

        .call-picker {
            position: absolute;
            inset: 0;
            z-index: 6;
            display: none;
            align-items: flex-end;
            justify-content: center;
            background: rgba(0, 0, 0, 0.55);
        }
        .call-picker.show { display: flex; }

        .call-picker-card {
            width: 100%;
            max-width: 440px;
            max-height: 75%;
            overflow-y: auto;
            padding: 1.2rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom, 0px));
            border-radius: 24px 24px 0 0;
            background: #ffffff;
            color: #0f172a;
        }
        .call-picker-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.2rem; }
        .call-picker-head h3 { margin: 0; font-size: 1.15rem; font-weight: 800; }
        .picker-close { width: 32px; height: 32px; border: none; border-radius: 50%; background: #f1f5f9; color: #64748b; font-size: 1.2rem; cursor: pointer; }

        .picker-row { display: flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0; border-bottom: 1px solid #f1f5f9; }
        .picker-add {
            padding: 0.4rem 1rem;
            border: none;
            border-radius: 999px;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            color: #fff;
            font-weight: 700;
            cursor: pointer;
        }
        .picker-add:disabled { opacity: 0.45; cursor: not-allowed; }

        @media (max-width: 480px) {
            .call-top { padding-right: 112px; }
        }
    `;

    function injectUi() {
        const style = document.createElement('style');
        style.id = 'call-group-style';
        style.textContent = STYLE;
        document.head.appendChild(style);

        document.body.insertAdjacentHTML('beforeend', `
            <div class="incoming-call" id="incoming-call" role="alertdialog" aria-live="assertive" aria-label="Incoming call">
                <div class="incoming-card">
                    <div class="incoming-avatar" id="incoming-avatar"></div>
                    <div class="incoming-name" id="incoming-name"></div>
                    <div class="incoming-kind" id="incoming-kind"></div>
                    <div class="incoming-actions">
                        <div class="incoming-action">
                            <button type="button" class="round-btn decline" id="btn-decline" aria-label="Decline call">${ICONS.hangup}</button>
                            <span>Decline</span>
                        </div>
                        <div class="incoming-action">
                            <button type="button" class="round-btn accept" id="btn-accept" aria-label="Accept call">${ICONS.phone}</button>
                            <span>Accept</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="call-overlay" id="call-overlay" role="dialog" aria-label="Call">
                <div class="call-stage">
                    <div class="call-grid" id="call-grid" data-count="0"></div>
                    <video id="local-video" autoplay playsinline muted></video>
                    <div class="call-top">
                        <div class="call-title" id="call-name"></div>
                        <div class="call-status" id="call-status"></div>
                    </div>
                </div>
                <div class="call-controls">
                    <button type="button" class="ctrl-btn" id="btn-mute" aria-label="Mute microphone">${ICONS.mic}</button>
                    <button type="button" class="ctrl-btn" id="btn-camera" aria-label="Turn camera off">${ICONS.video}</button>
                    <button type="button" class="ctrl-btn" id="btn-add" aria-label="Add someone to the call">${ICONS.userPlus}</button>
                    <button type="button" class="ctrl-btn hangup" id="btn-hangup" aria-label="End call">${ICONS.hangup}</button>
                </div>

                <div class="call-picker" id="call-picker">
                    <div class="call-picker-card">
                        <div class="call-picker-head">
                            <h3>Add to call</h3>
                            <button type="button" class="picker-close" id="picker-close" aria-label="Close">&times;</button>
                        </div>
                        <p class="fx-sub" id="picker-hint"></p>
                        <div id="picker-list"></div>
                    </div>
                </div>
            </div>
        `);

        $('local-video').muted = true;
        $('btn-accept').addEventListener('click', acceptIncoming);
        $('btn-decline').addEventListener('click', declineIncoming);
        $('btn-mute').addEventListener('click', toggleMute);
        $('btn-camera').addEventListener('click', toggleCamera);
        $('btn-add').addEventListener('click', openPicker);
        $('btn-hangup').addEventListener('click', () => endCall(true));
        $('picker-close').addEventListener('click', closePicker);
        $('call-picker').addEventListener('click', (e) => { if (e.target === $('call-picker')) closePicker(); });
        $('picker-list').addEventListener('click', (e) => {
            const btn = e.target.closest('.picker-add');
            if (!btn) return;
            inviteUser(Number(btn.dataset.id));
            renderPicker();
        });

        // Tell the others if this tab is closed during a call
        window.addEventListener('pagehide', () => {
            if (call) endCall(true);
            else if (incoming) declineIncoming();
        });
    }

    // ---------- Hook into chat.js ----------

    const originalHandleWs = window.handleWebSocketMessage;
    window.handleWebSocketMessage = function (data) {
        switch (data && data.type) {
            case 'call_offer': onOffer(data); return;
            case 'call_invite': onInvite(data); return;
            case 'call_roster': onRoster(data); return;
            case 'call_answer': onAnswer(data); return;
            case 'call_ice': onIce(data); return;
            case 'call_end': onEnd(data); return;
            case 'call_reject': onReject(data); return;
            case 'call_unavailable': onUnavailable(data); return;
            case 'call_media': onMedia(data); return;
        }
        return originalHandleWs(data);
    };

    const originalSelectUser = window.selectUser;
    window.selectUser = function (user) {
        const result = originalSelectUser(user);   // draws the chat header right away
        addCallButtons(user);
        return result;
    };

    function addCallButtons(user) {
        const header = $('chat-header');
        if (!header || header.querySelector('.call-actions') || !supportsCalls()) return;

        const box = document.createElement('div');
        box.className = 'call-actions';
        box.innerHTML = `
            <button type="button" class="call-btn" data-video="0" title="Voice call" aria-label="Voice call">${ICONS.phone}</button>
            <button type="button" class="call-btn" data-video="1" title="Video call" aria-label="Video call">${ICONS.video}</button>
        `;
        box.addEventListener('click', (e) => {
            const btn = e.target.closest('.call-btn');
            if (btn) startCall(user.id, user.username, btn.dataset.video === '1');
        });
        header.appendChild(box);
    }

    // ---------- Call state helpers ----------

    function newCall(id, video, stream, state) {
        return {
            id: id, video: video, state: state, localStream: stream,
            muted: false, cameraOff: false,
            peers: new Map(), invites: new Map(),
            startedAt: 0, timer: null, ringTimeout: null
        };
    }

    function rosterList() {
        const list = [{ id: currentUser.id, name: currentUser.username }];
        call.peers.forEach(p => list.push({ id: p.id, name: p.name }));
        return list;
    }

    function cleanParticipants(list) {
        if (!Array.isArray(list)) return [];
        return list
            .filter(p => p && Number.isInteger(p.id))
            .slice(0, MAX_PARTICIPANTS + 1)
            .map(p => ({ id: p.id, name: String(p.name || '').slice(0, 50) }));
    }

    // ---------- Tiles and screen ----------

    function updateGridCount() {
        const grid = $('call-grid');
        grid.dataset.count = grid.children.length;
    }

    function buildTile(userId, name, stream, statusText) {
        const tile = document.createElement('div');
        tile.className = 'call-tile';
        tile.dataset.userId = userId;
        tile.innerHTML = `
            <video autoplay playsinline></video>
            <div class="tile-avatar" style="background:${avatarGradient(name)}">${avatarHtml(userId, name)}</div>
            <div class="tile-state"></div>
            <div class="tile-name"></div>
        `;
        tile.querySelector('.tile-name').textContent = name;
        tile.querySelector('.tile-state').textContent = statusText || '';
        if (stream) tile.querySelector('video').srcObject = stream;

        $('call-grid').appendChild(tile);
        updateGridCount();
        return tile;
    }

    function updateTile(peer) {
        if (!peer.tile) return;
        const showVideo = hasVideoTrack(peer.stream) && !peer.cameraOff;
        peer.tile.classList.toggle('has-video', showVideo);
        peer.tile.querySelector('.tile-state').textContent = peer.connected ? '' : (peer.statusText || 'Connecting...');
    }

    function showCallUi() {
        const overlay = $('call-overlay');
        overlay.classList.remove('self-camera-off');
        overlay.classList.toggle('has-local-video', hasVideoTrack(call.localStream));
        overlay.classList.add('show');

        $('call-grid').innerHTML = '';
        updateGridCount();

        $('local-video').srcObject = call.localStream;
        $('btn-camera').style.display = hasVideoTrack(call.localStream) ? '' : 'none';

        $('btn-mute').classList.remove('off');
        $('btn-mute').innerHTML = ICONS.mic;
        $('btn-camera').classList.remove('off');
        $('btn-camera').innerHTML = ICONS.video;
        closePicker();
    }

    function refreshStatus() {
        if (!call) return;

        const names = [];
        call.peers.forEach(p => names.push(p.name));
        call.invites.forEach(inv => names.push(inv.name));
        $('call-name').textContent = names.length ? names.join(', ') : 'Call';

        let text;
        if (call.state === 'connected') {
            const seconds = Math.floor((Date.now() - call.startedAt) / 1000);
            let connected = 0;
            call.peers.forEach(p => { if (p.connected) connected++; });
            text = formatDuration(seconds) + (connected > 1 ? ` \u00b7 ${connected + 1} people` : '');
        } else {
            text = call.state === 'calling' ? 'Calling...' : 'Connecting...';
        }
        $('call-status').textContent = text;
    }

    // ---------- Starting a call ----------

    async function startCall(peerId, peerName, video) {
        if (call || incoming || starting) {
            showNotification('You are already in a call');
            return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showNotification('Not connected yet. Try again in a moment.');
            return;
        }
        if (!onlineSet.has(peerId)) {
            showNotification(`${peerName} is offline`);
            return;
        }

        starting = true;
        let stream;
        try {
            stream = await getMedia(video);
        } catch (err) {
            starting = false;
            showNotification(mediaErrorMessage(err, video));
            return;
        }
        starting = false;

        call = newCall(makeId(), video, stream, 'calling');
        showCallUi();

        try {
            const peer = createPeer(peerId, peerName);
            peer.statusText = 'Calling...';
            updateTile(peer);
            await offerTo(peer, false);
        } catch (err) {
            console.error('Could not start the call:', err);
            showNotification('Could not start the call');
            endCall(false);
            return;
        }

        call.ringTimeout = setTimeout(() => {
            if (call && call.state === 'calling') {
                showNotification(`${peerName} did not answer`);
                endCall(true);
            }
        }, RING_TIMEOUT_MS);
    }

    // ---------- Connections with other people ----------

    function createPeer(userId, name) {
        let peer = call.peers.get(userId);
        if (peer) return peer;

        peer = {
            id: userId, name: name || nameOf(userId), pc: null, stream: new MediaStream(),
            connected: false, offering: false, cameraOff: false, pending: [],
            dropTimer: null, statusText: 'Connecting...', tile: null
        };
        peer.pc = newConnection(peer);
        call.peers.set(userId, peer);
        peer.tile = buildTile(userId, peer.name, peer.stream, peer.statusText);
        refreshStatus();
        return peer;
    }

    function newConnection(peer) {
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        call.localStream.getTracks().forEach(track => pc.addTrack(track, call.localStream));

        pc.onicecandidate = (e) => {
            if (e.candidate && call && peer.pc === pc) {
                wsSend({ type: 'call_ice', receiver_id: peer.id, call_id: call.id, candidate: e.candidate.toJSON() });
            }
        };

        pc.ontrack = (e) => {
            if (!call || peer.pc !== pc) return;
            peer.stream.addTrack(e.track);
            updateTile(peer);
            const video = peer.tile && peer.tile.querySelector('video');
            if (video && video.play) video.play().catch(() => {});
        };

        pc.onconnectionstatechange = () => onPeerState(peer, pc);
        return pc;
    }

    // Start over with a fresh connection to this person (keeps their tile)
    function resetPeerConnection(peer) {
        closePc(peer.pc);
        peer.stream = new MediaStream();
        peer.connected = false;
        peer.offering = false;
        peer.pc = newConnection(peer);
        if (peer.tile) peer.tile.querySelector('video').srcObject = peer.stream;
        updateTile(peer);
    }

    async function offerTo(peer, join) {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        peer.offering = true;
        wsSend({
            type: 'call_offer', receiver_id: peer.id, call_id: call.id, video: call.video,
            join: !!join, participants: rosterList(), sdp: { type: offer.type, sdp: offer.sdp }
        });
        sendMediaState(peer.id);
    }

    function sendMediaState(peerId) {
        if (call && call.cameraOff) {
            wsSend({ type: 'call_media', receiver_id: peerId, call_id: call.id, video: false });
        }
    }

    // Tell everyone we are connected to about everyone we are connected to,
    // so people who were added at the same moment can find each other
    function broadcastRoster() {
        if (!call) return;
        const list = rosterList();
        call.peers.forEach(p => {
            wsSend({ type: 'call_roster', receiver_id: p.id, call_id: call.id, participants: list });
        });
    }

    async function flushPeerCandidates(peer) {
        const list = peer.pending;
        peer.pending = [];
        for (const candidate of list) {
            try { await peer.pc.addIceCandidate(candidate); }
            catch (err) { console.warn('ICE candidate skipped:', err); }
        }
    }

    function onPeerState(peer, pc) {
        if (!call || peer.pc !== pc) return;
        const state = pc.connectionState;

        if (state === 'connected') {
            peer.connected = true;
            clearTimeout(peer.dropTimer);
            updateTile(peer);
            onAnyConnected();
        } else if (state === 'disconnected') {
            peer.statusText = 'Reconnecting...';
            peer.connected = false;
            updateTile(peer);
            clearTimeout(peer.dropTimer);
            peer.dropTimer = setTimeout(() => {
                if (call && peer.pc === pc && pc.connectionState !== 'connected') {
                    removePeer(peer, `The connection with ${peer.name} was lost`);
                }
            }, DISCONNECT_GRACE_MS);
        } else if (state === 'failed') {
            removePeer(peer, `Could not connect with ${peer.name}. Your network may block direct calls.`);
        }
    }

    function onAnyConnected() {
        if (!call) return;
        clearTimeout(call.ringTimeout);
        Ringer.stop();
        if (call.state !== 'connected') {
            call.state = 'connected';
            call.startedAt = Date.now();
            call.timer = setInterval(refreshStatus, 1000);
        }
        refreshStatus();
    }

    function removePeer(peer, message) {
        if (!call || call.peers.get(peer.id) !== peer) return;
        clearTimeout(peer.dropTimer);
        closePc(peer.pc);
        if (peer.tile) peer.tile.remove();
        call.peers.delete(peer.id);
        updateGridCount();

        if (call.peers.size === 0 && call.invites.size === 0) {
            endCall(false);
            showNotification(message || 'The call ended');
        } else {
            if (message) showNotification(message);
            refreshStatus();
        }
    }

    function removeInvite(userId) {
        const inv = call && call.invites.get(userId);
        if (!inv) return;
        clearTimeout(inv.timeout);
        if (inv.tile) inv.tile.remove();
        call.invites.delete(userId);
        updateGridCount();
    }

    function maybeEndIfEmpty() {
        if (call && call.peers.size === 0 && call.invites.size === 0) {
            endCall(false);
            showNotification('The call ended');
        } else {
            refreshStatus();
        }
    }

    // ---------- Adding people to a call ----------

    function openPicker() {
        if (!call) return;
        renderPicker();
        $('call-picker').classList.add('show');
    }

    function closePicker() {
        const picker = $('call-picker');
        if (picker) picker.classList.remove('show');
    }

    function renderPicker() {
        if (!call) return;
        const taken = new Set();
        call.peers.forEach((p, id) => taken.add(id));
        call.invites.forEach((inv, id) => taken.add(id));

        const slots = MAX_PARTICIPANTS - 1 - call.peers.size - call.invites.size;
        const candidates = users.filter(u => onlineSet.has(u.id) && !taken.has(u.id));

        $('picker-hint').textContent = slots > 0
            ? `You can add ${slots} more ${slots === 1 ? 'person' : 'people'}. Only people who are online are shown.`
            : `This call is full (up to ${MAX_PARTICIPANTS} people).`;

        $('picker-list').innerHTML = candidates.length
            ? candidates.map(u => `
                <div class="picker-row">
                    <span class="pick-avatar" style="background:${avatarGradient(u.username)}">${avatarHtml(u.id, u.username)}</span>
                    <span class="pick-name">${escapeHtml(u.username)}</span>
                    <button type="button" class="picker-add" data-id="${u.id}" ${slots <= 0 ? 'disabled' : ''}>Add</button>
                </div>`).join('')
            : '<p class="fx-sub">Nobody else is online right now.</p>';
    }

    function inviteUser(userId) {
        if (!call) return;
        const name = nameOf(userId);

        if (call.peers.has(userId) || call.invites.has(userId)) return;
        if (1 + call.peers.size + call.invites.size >= MAX_PARTICIPANTS) {
            showNotification(`A call can have up to ${MAX_PARTICIPANTS} people`);
            return;
        }
        if (!onlineSet.has(userId)) {
            showNotification(`${name} is offline`);
            return;
        }

        wsSend({
            type: 'call_invite', receiver_id: userId, call_id: call.id,
            video: call.video, participants: rosterList()
        });

        const tile = buildTile(userId, name, null, 'Calling...');
        const timeout = setTimeout(() => {
            if (call && call.invites.has(userId)) {
                removeInvite(userId);
                showNotification(`${name} did not answer`);
                maybeEndIfEmpty();
            }
        }, RING_TIMEOUT_MS);
        call.invites.set(userId, { name: name, tile: tile, timeout: timeout });
        refreshStatus();
    }

    // ---------- Receiving a call or an invitation ----------

    function ringIncoming(info) {
        info.pending = [];
        incoming = info;

        const av = $('incoming-avatar');
        av.style.background = avatarGradient(info.from_username);
        av.innerHTML = avatarHtml(info.from_id, info.from_username);
        $('incoming-name').textContent = info.from_username;

        const kind = info.video ? 'video' : 'voice';
        if (info.kind === 'invite') {
            const others = (info.participants || [])
                .filter(p => p.id !== currentUser.id && p.id !== info.from_id)
                .map(p => p.name)
                .filter(Boolean);
            $('incoming-kind').textContent =
                `Invites you to a ${kind} call` + (others.length ? ` with ${others.join(', ')}` : '');
        } else {
            $('incoming-kind').textContent = `Incoming ${kind} call`;
        }
        $('btn-accept').innerHTML = info.video ? ICONS.video : ICONS.phone;
        $('incoming-call').classList.add('show');
        Ringer.start();

        info.timeout = setTimeout(() => {
            if (incoming && incoming.call_id === info.call_id) {
                showNotification(`Missed call from ${info.from_username}`);
                clearIncoming();
            }
        }, RING_TIMEOUT_MS);
    }

    function clearIncoming() {
        if (incoming) clearTimeout(incoming.timeout);
        incoming = null;
        $('incoming-call').classList.remove('show');
        Ringer.stop();
    }

    function declineIncoming() {
        if (!incoming) return;
        wsSend({ type: 'call_reject', receiver_id: incoming.from_id, call_id: incoming.call_id, reason: 'declined' });
        clearIncoming();
    }

    function onOffer(data) {
        if (!data.sdp || !data.call_id) return;

        // Someone joining a call we are already in
        if (call && call.id === data.call_id) {
            onOfferInCall(data);
            return;
        }
        // An offer to join a call we are not in (it already ended)
        if (data.join) {
            wsSend({ type: 'call_end', receiver_id: data.from_id, call_id: data.call_id });
            return;
        }
        if (call || incoming || starting) {
            wsSend({ type: 'call_reject', receiver_id: data.from_id, call_id: data.call_id, reason: 'busy' });
            return;
        }

        ringIncoming({
            kind: 'offer', from_id: data.from_id, from_username: data.from_username,
            call_id: data.call_id, video: !!data.video, sdp: data.sdp
        });
    }

    function onInvite(data) {
        if (!data.call_id) return;
        if (call && call.id === data.call_id) return;                    // already in this call
        if (incoming && incoming.call_id === data.call_id) return;       // duplicate invitation
        if (call || incoming || starting) {
            wsSend({ type: 'call_reject', receiver_id: data.from_id, call_id: data.call_id, reason: 'busy' });
            return;
        }

        ringIncoming({
            kind: 'invite', from_id: data.from_id, from_username: data.from_username,
            call_id: data.call_id, video: !!data.video,
            participants: cleanParticipants(data.participants)
        });
    }

    async function acceptIncoming() {
        if (!incoming) return;
        const inc = incoming;

        $('incoming-call').classList.remove('show');
        Ringer.stop();
        clearTimeout(inc.timeout);

        starting = true;
        let stream;
        try {
            stream = await getMedia(inc.video);
        } catch (err) {
            starting = false;
            showNotification(mediaErrorMessage(err, inc.video));
            wsSend({ type: 'call_reject', receiver_id: inc.from_id, call_id: inc.call_id, reason: 'declined' });
            incoming = null;
            return;
        }
        starting = false;

        // They may have hung up while the permission prompt was open
        if (!incoming || incoming.call_id !== inc.call_id) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        incoming = null;

        call = newCall(inc.call_id, inc.video, stream, 'connecting');
        showCallUi();

        try {
            if (inc.kind === 'offer') {
                // A normal call: answer the caller
                const peer = createPeer(inc.from_id, inc.from_username);
                peer.pending = inc.pending;
                await peer.pc.setRemoteDescription(inc.sdp);
                await flushPeerCandidates(peer);
                const answer = await peer.pc.createAnswer();
                await peer.pc.setLocalDescription(answer);
                wsSend({
                    type: 'call_answer', receiver_id: peer.id, call_id: call.id,
                    sdp: { type: answer.type, sdp: answer.sdp }
                });
            } else {
                // An invitation: connect to everyone who is in the call
                const others = inc.participants.filter(p => p.id !== currentUser.id);
                if (!others.length) {
                    showNotification('That call has already ended');
                    endCall(false);
                    return;
                }
                for (const p of others) {
                    if (call.peers.size + 1 >= MAX_PARTICIPANTS) break;
                    const peer = createPeer(p.id, p.name || nameOf(p.id));
                    await offerTo(peer, true);
                }
            }
        } catch (err) {
            console.error('Could not join the call:', err);
            showNotification('Could not join the call');
            endCall(true);
            return;
        }

        refreshStatus();
        call.ringTimeout = setTimeout(() => {
            if (call && call.state !== 'connected') {
                showNotification('Could not join the call');
                endCall(true);
            }
        }, JOIN_TIMEOUT_MS);
    }

    // ---------- Signaling messages ----------

    async function onOfferInCall(data) {
        let peer = call.peers.get(data.from_id);

        if (!peer) {
            if (call.peers.size + 1 >= MAX_PARTICIPANTS) {
                wsSend({ type: 'call_reject', receiver_id: data.from_id, call_id: call.id, reason: 'full' });
                return;
            }
            removeInvite(data.from_id);   // they accepted our invitation
            peer = createPeer(data.from_id, data.from_username);
        } else if (peer.offering) {
            // Both sides sent an offer at the same moment: the lower user id keeps its offer
            if (currentUser.id < data.from_id) return;
            resetPeerConnection(peer);
        } else if (peer.pc.remoteDescription) {
            resetPeerConnection(peer);    // they are starting over
        }

        try {
            await peer.pc.setRemoteDescription(data.sdp);
            await flushPeerCandidates(peer);
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            wsSend({
                type: 'call_answer', receiver_id: peer.id, call_id: call.id,
                sdp: { type: answer.type, sdp: answer.sdp }
            });
            peer.statusText = 'Connecting...';
            updateTile(peer);
            sendMediaState(peer.id);
            broadcastRoster();
        } catch (err) {
            console.error('Could not answer:', err);
            removePeer(peer, `Could not connect with ${peer.name}`);
        }
    }

    async function onAnswer(data) {
        if (!call || data.call_id !== call.id || !data.sdp) return;
        const peer = call.peers.get(data.from_id);
        if (!peer || !peer.offering) return;

        try {
            await peer.pc.setRemoteDescription(data.sdp);
            peer.offering = false;
            peer.statusText = 'Connecting...';
            updateTile(peer);
            if (call.state === 'calling') {
                clearTimeout(call.ringTimeout);
                call.state = 'connecting';
            }
            refreshStatus();
            await flushPeerCandidates(peer);
        } catch (err) {
            console.error('Bad answer:', err);
            removePeer(peer, `Could not connect with ${peer.name}`);
        }
    }

    function onIce(data) {
        if (!data.candidate) return;

        // Network candidates can arrive while the call is still ringing
        if (incoming && incoming.call_id === data.call_id && incoming.from_id === data.from_id) {
            incoming.pending.push(data.candidate);
            return;
        }
        if (!call || data.call_id !== call.id) return;

        const peer = call.peers.get(data.from_id);
        if (!peer) return;

        if (peer.pc.remoteDescription) {
            peer.pc.addIceCandidate(data.candidate).catch(err => console.warn('ICE candidate skipped:', err));
        } else {
            peer.pending.push(data.candidate);
        }
    }

    function onRoster(data) {
        if (!call || data.call_id !== call.id) return;

        cleanParticipants(data.participants).forEach(p => {
            if (p.id === currentUser.id || call.peers.has(p.id) || call.invites.has(p.id)) return;

            // Give their own offer a moment to arrive before we start one
            setTimeout(() => {
                if (!call || call.peers.has(p.id) || call.invites.has(p.id)) return;
                if (call.peers.size + 1 >= MAX_PARTICIPANTS) return;

                const peer = createPeer(p.id, p.name || nameOf(p.id));
                offerTo(peer, true).catch(err => {
                    console.error('Could not reach a participant:', err);
                    removePeer(peer);
                });
            }, ROSTER_GRACE_MS);
        });
    }

    function onEnd(data) {
        if (incoming && incoming.call_id === data.call_id && incoming.from_id === data.from_id) {
            showNotification(`Missed call from ${incoming.from_username}`);
            clearIncoming();
            return;
        }
        if (!call || data.call_id !== call.id) return;

        const peer = call.peers.get(data.from_id);
        if (!peer) return;

        if (!peer.connected) {
            removePeer(peer);   // never connected (for example they had already left)
        } else if (call.peers.size === 1) {
            removePeer(peer, `${peer.name} ended the call`);
        } else {
            removePeer(peer, `${peer.name} left the call`);
        }
    }

    function onReject(data) {
        if (!call || data.call_id !== call.id) return;

        const peer = call.peers.get(data.from_id);
        const inv = call.invites.get(data.from_id);
        const name = peer ? peer.name : (inv ? inv.name : 'They');

        let message;
        if (data.reason === 'busy') message = `${name} is on another call`;
        else if (data.reason === 'full') message = 'That call is full';
        else message = `${name} declined the call`;

        if (inv) removeInvite(data.from_id);
        if (peer) {
            removePeer(peer, message);
        } else {
            showNotification(message);
            maybeEndIfEmpty();
        }
    }

    function onUnavailable(data) {
        if (!call || data.call_id !== call.id) return;

        const peer = call.peers.get(data.from_id);
        const inv = call.invites.get(data.from_id);
        const name = peer ? peer.name : (inv ? inv.name : 'They');

        if (inv) removeInvite(data.from_id);
        if (peer) {
            removePeer(peer, `${name} is offline`);
        } else {
            showNotification(`${name} is offline`);
            maybeEndIfEmpty();
        }
    }

    function onMedia(data) {
        if (!call || data.call_id !== call.id) return;
        const peer = call.peers.get(data.from_id);
        if (!peer) return;
        peer.cameraOff = data.video === false;
        updateTile(peer);
    }

    // ---------- In-call controls ----------

    function toggleMute() {
        if (!call) return;
        const tracks = call.localStream.getAudioTracks();
        if (!tracks.length) return;

        call.muted = !call.muted;
        tracks.forEach(t => { t.enabled = !call.muted; });

        const btn = $('btn-mute');
        btn.classList.toggle('off', call.muted);
        btn.innerHTML = call.muted ? ICONS.micOff : ICONS.mic;
        btn.setAttribute('aria-label', call.muted ? 'Unmute microphone' : 'Mute microphone');
    }

    function toggleCamera() {
        if (!call) return;
        const tracks = call.localStream.getVideoTracks();
        if (!tracks.length) return;

        call.cameraOff = !call.cameraOff;
        tracks.forEach(t => { t.enabled = !call.cameraOff; });

        const btn = $('btn-camera');
        btn.classList.toggle('off', call.cameraOff);
        btn.innerHTML = call.cameraOff ? ICONS.videoOff : ICONS.video;
        btn.setAttribute('aria-label', call.cameraOff ? 'Turn camera on' : 'Turn camera off');
        $('call-overlay').classList.toggle('self-camera-off', call.cameraOff);

        call.peers.forEach(p => {
            wsSend({ type: 'call_media', receiver_id: p.id, call_id: call.id, video: !call.cameraOff });
        });
    }

    // Leaves the call. notify = true tells everyone (so their phones stop ringing / they see you left)
    function endCall(notify) {
        if (!call) return;
        const c = call;
        call = null;

        if (notify) {
            c.peers.forEach(p => wsSend({ type: 'call_end', receiver_id: p.id, call_id: c.id }));
            c.invites.forEach((inv, userId) => wsSend({ type: 'call_end', receiver_id: userId, call_id: c.id }));
        }

        clearTimeout(c.ringTimeout);
        clearInterval(c.timer);
        c.invites.forEach(inv => clearTimeout(inv.timeout));
        c.peers.forEach(p => {
            clearTimeout(p.dropTimer);
            closePc(p.pc);
        });
        if (c.localStream) c.localStream.getTracks().forEach(t => t.stop());

        $('call-grid').innerHTML = '';
        updateGridCount();
        $('local-video').srcObject = null;
        closePicker();
        $('call-overlay').classList.remove('show', 'has-local-video', 'self-camera-off');
        Ringer.stop();
    }

    function init() {
        injectUi();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();