/**
 * Voice and video calls (one-to-one) using WebRTC.
 * Plugs into chat.js (which must load first): it uses chat.js globals (ws, onlineSet)
 * and wraps handleWebSocketMessage and selectUser. Call setup messages travel over the
 * existing chat WebSocket; the call itself goes directly between the two browsers.
 *
 * Optional: define CALL_ICE_SERVERS in config.js to add a TURN server (see the notes).
 */
(function () {
    'use strict';

    const RING_TIMEOUT_MS = 45000;
    const DISCONNECT_GRACE_MS = 12000;

    const SVG = (inner, extra) =>
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${inner}</svg>`;

    const PHONE_PATH = '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>';

    const ICONS = {
        phone: SVG(PHONE_PATH),
        hangup: SVG(PHONE_PATH, 'style="transform:rotate(135deg)"'),
        video: SVG('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'),
        videoOff: SVG('<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>'),
        mic: SVG('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
        micOff: SVG('<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>')
    };

    let call = null;             // the call in progress (or being set up)
    let incoming = null;         // an offer waiting to be accepted or declined
    let starting = false;        // true while the caller is asking for mic/camera permission
    let pendingCandidates = [];  // network candidates that arrived before we were ready

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

    function injectUi() {
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
                    <video id="remote-video" autoplay playsinline></video>
                    <video id="local-video" autoplay playsinline muted></video>
                    <div class="call-center">
                        <div class="call-avatar" id="call-avatar"></div>
                        <div class="call-name" id="call-name"></div>
                        <div class="call-status" id="call-status"></div>
                    </div>
                </div>
                <div class="call-controls">
                    <button type="button" class="ctrl-btn" id="btn-mute" aria-label="Mute microphone">${ICONS.mic}</button>
                    <button type="button" class="ctrl-btn" id="btn-camera" aria-label="Turn camera off">${ICONS.video}</button>
                    <button type="button" class="ctrl-btn hangup" id="btn-hangup" aria-label="End call">${ICONS.hangup}</button>
                </div>
            </div>
        `);

        $('local-video').muted = true;
        $('btn-accept').addEventListener('click', acceptIncoming);
        $('btn-decline').addEventListener('click', declineIncoming);
        $('btn-mute').addEventListener('click', toggleMute);
        $('btn-camera').addEventListener('click', toggleCamera);
        $('btn-hangup').addEventListener('click', () => endCall(true));

        // Tell the other person if this tab is closed during a call
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

        call = {
            id: makeId(), peerId: peerId, peerName: peerName, video: video, role: 'caller',
            state: 'calling', localStream: stream, remoteStream: null, pc: null,
            muted: false, cameraOff: false, peerCameraOff: false,
            startedAt: 0, timer: null, ringTimeout: null, dropTimer: null
        };
        showCallUi();
        setStatus('Calling...');

        try {
            buildPeer();
            const offer = await call.pc.createOffer();
            await call.pc.setLocalDescription(offer);
            wsSend({
                type: 'call_offer', receiver_id: peerId, call_id: call.id, video: video,
                sdp: { type: offer.type, sdp: offer.sdp }
            });
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

    function buildPeer() {
        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        call.pc = pc;
        call.remoteStream = new MediaStream();
        $('remote-video').srcObject = call.remoteStream;

        call.localStream.getTracks().forEach(track => pc.addTrack(track, call.localStream));

        pc.onicecandidate = (e) => {
            if (e.candidate && call && call.pc === pc) {
                wsSend({ type: 'call_ice', receiver_id: call.peerId, call_id: call.id, candidate: e.candidate.toJSON() });
            }
        };

        pc.ontrack = (e) => {
            if (!call || call.pc !== pc) return;
            call.remoteStream.addTrack(e.track);
            updateVideoState();
            const rv = $('remote-video');
            if (rv.play) rv.play().catch(() => {});
        };

        pc.onconnectionstatechange = () => {
            if (!call || call.pc !== pc) return;
            const state = pc.connectionState;

            if (state === 'connected') {
                onConnected();
            } else if (state === 'disconnected') {
                setStatus('Reconnecting...');
                clearTimeout(call.dropTimer);
                call.dropTimer = setTimeout(() => {
                    if (call && call.pc === pc && pc.connectionState !== 'connected') {
                        showNotification('The call connection was lost');
                        endCall(true);
                    }
                }, DISCONNECT_GRACE_MS);
            } else if (state === 'failed') {
                showNotification('The call could not connect. Your network may block direct calls.');
                endCall(true);
            }
        };
    }

    function onConnected() {
        clearTimeout(call.ringTimeout);
        clearTimeout(call.dropTimer);
        if (call.state === 'connected') { setStatus(formatDuration(Math.floor((Date.now() - call.startedAt) / 1000))); return; }

        call.state = 'connected';
        call.startedAt = Date.now();
        Ringer.stop();
        setStatus('00:00');
        call.timer = setInterval(() => {
            if (call && call.state === 'connected') {
                setStatus(formatDuration(Math.floor((Date.now() - call.startedAt) / 1000)));
            }
        }, 1000);
    }

    // ---------- Receiving a call ----------

    function onOffer(data) {
        if (call || incoming || starting) {
            wsSend({ type: 'call_reject', receiver_id: data.from_id, call_id: data.call_id, reason: 'busy' });
            return;
        }
        if (!data.sdp || !data.call_id) return;

        incoming = data;
        pendingCandidates = [];

        const av = $('incoming-avatar');
        av.style.background = avatarGradient(data.from_username);
        av.innerHTML = avatarHtml(data.from_id, data.from_username);
        $('incoming-name').textContent = data.from_username;
        $('incoming-kind').textContent = data.video ? 'Incoming video call' : 'Incoming voice call';
        $('btn-accept').innerHTML = data.video ? ICONS.video : ICONS.phone;
        $('incoming-call').classList.add('show');
        Ringer.start();

        incoming.timeout = setTimeout(() => {
            if (incoming && incoming.call_id === data.call_id) {
                showNotification(`Missed call from ${data.from_username}`);
                clearIncoming();
            }
        }, RING_TIMEOUT_MS);
    }

    function clearIncoming() {
        if (incoming) clearTimeout(incoming.timeout);
        incoming = null;
        pendingCandidates = [];
        $('incoming-call').classList.remove('show');
        Ringer.stop();
    }

    function declineIncoming() {
        if (!incoming) return;
        wsSend({ type: 'call_reject', receiver_id: incoming.from_id, call_id: incoming.call_id, reason: 'declined' });
        clearIncoming();
    }

    async function acceptIncoming() {
        if (!incoming) return;
        const offer = incoming;

        $('incoming-call').classList.remove('show');
        Ringer.stop();
        clearTimeout(offer.timeout);

        let stream;
        try {
            stream = await getMedia(!!offer.video);
        } catch (err) {
            showNotification(mediaErrorMessage(err, !!offer.video));
            wsSend({ type: 'call_reject', receiver_id: offer.from_id, call_id: offer.call_id, reason: 'declined' });
            incoming = null;
            pendingCandidates = [];
            return;
        }

        // The caller may have hung up while the permission prompt was open
        if (!incoming || incoming.call_id !== offer.call_id) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        incoming = null;

        call = {
            id: offer.call_id, peerId: offer.from_id, peerName: offer.from_username,
            video: !!offer.video, role: 'callee', state: 'connecting',
            localStream: stream, remoteStream: null, pc: null,
            muted: false, cameraOff: false, peerCameraOff: false,
            startedAt: 0, timer: null, ringTimeout: null, dropTimer: null
        };
        showCallUi();
        setStatus('Connecting...');

        try {
            buildPeer();
            await call.pc.setRemoteDescription(offer.sdp);
            await flushCandidates();
            const answer = await call.pc.createAnswer();
            await call.pc.setLocalDescription(answer);
            wsSend({
                type: 'call_answer', receiver_id: offer.from_id, call_id: call.id,
                sdp: { type: answer.type, sdp: answer.sdp }
            });
        } catch (err) {
            console.error('Could not answer the call:', err);
            showNotification('Could not answer the call');
            endCall(true);
        }
    }

    // ---------- Signaling messages ----------

    async function onAnswer(data) {
        if (!call || call.id !== data.call_id || call.role !== 'caller' || !data.sdp) return;
        try {
            clearTimeout(call.ringTimeout);
            call.state = 'connecting';
            setStatus('Connecting...');
            await call.pc.setRemoteDescription(data.sdp);
            await flushCandidates();
        } catch (err) {
            console.error('Bad answer:', err);
            showNotification('Could not connect the call');
            endCall(true);
        }
    }

    function onIce(data) {
        if (!data.candidate) return;
        const forCall = call && data.call_id === call.id;
        const forIncoming = incoming && data.call_id === incoming.call_id;
        if (!forCall && !forIncoming) return;

        if (forCall && call.pc && call.pc.remoteDescription) {
            call.pc.addIceCandidate(data.candidate).catch(err => console.error('ICE error:', err));
        } else {
            pendingCandidates.push(data.candidate);   // used once the connection is ready
        }
    }

    async function flushCandidates() {
        const list = pendingCandidates;
        pendingCandidates = [];
        for (const candidate of list) {
            try { await call.pc.addIceCandidate(candidate); }
            catch (err) { console.error('ICE error:', err); }
        }
    }

    function onEnd(data) {
        if (incoming && data.call_id === incoming.call_id) {
            showNotification(`Missed call from ${incoming.from_username}`);
            clearIncoming();
            return;
        }
        if (call && data.call_id === call.id) {
            showNotification('The call ended');
            endCall(false);
        }
    }

    function onReject(data) {
        if (!call || data.call_id !== call.id) return;
        showNotification(data.reason === 'busy'
            ? `${call.peerName} is on another call`
            : `${call.peerName} declined the call`);
        endCall(false);
    }

    function onUnavailable(data) {
        if (!call || data.call_id !== call.id) return;
        showNotification(`${call.peerName} is offline`);
        endCall(false);
    }

    function onMedia(data) {
        if (!call || data.call_id !== call.id) return;
        call.peerCameraOff = data.video === false;
        updateVideoState();
    }

    // ---------- In-call controls and screen ----------

    function showCallUi() {
        const overlay = $('call-overlay');
        overlay.classList.remove('has-remote-video', 'peer-camera-off', 'self-camera-off');
        overlay.classList.toggle('has-local-video', hasVideoTrack(call.localStream));
        overlay.classList.add('show');

        const av = $('call-avatar');
        av.style.background = avatarGradient(call.peerName);
        av.innerHTML = avatarHtml(call.peerId, call.peerName);
        $('call-name').textContent = call.peerName;

        $('local-video').srcObject = call.localStream;
        $('btn-camera').style.display = hasVideoTrack(call.localStream) ? '' : 'none';

        $('btn-mute').classList.remove('off');
        $('btn-mute').innerHTML = ICONS.mic;
        $('btn-camera').classList.remove('off');
        $('btn-camera').innerHTML = ICONS.video;
    }

    function setStatus(text) {
        $('call-status').textContent = text;
    }

    function updateVideoState() {
        if (!call) return;
        const overlay = $('call-overlay');
        overlay.classList.toggle('has-remote-video', hasVideoTrack(call.remoteStream));
        overlay.classList.toggle('peer-camera-off', call.peerCameraOff);
    }

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

        wsSend({ type: 'call_media', receiver_id: call.peerId, call_id: call.id, video: !call.cameraOff });
    }

    // Ends the call. notify = true tells the other person (so their phone stops ringing / ends too)
    function endCall(notify) {
        if (!call) return;
        const c = call;
        call = null;

        if (notify) wsSend({ type: 'call_end', receiver_id: c.peerId, call_id: c.id });

        clearTimeout(c.ringTimeout);
        clearTimeout(c.dropTimer);
        clearInterval(c.timer);

        if (c.pc) {
            c.pc.onicecandidate = null;
            c.pc.ontrack = null;
            c.pc.onconnectionstatechange = null;
            try { c.pc.close(); } catch (e) { /* already closed */ }
        }
        if (c.localStream) c.localStream.getTracks().forEach(t => t.stop());

        pendingCandidates = [];
        $('remote-video').srcObject = null;
        $('local-video').srcObject = null;
        $('call-overlay').classList.remove('show', 'has-remote-video', 'has-local-video', 'peer-camera-off', 'self-camera-off');
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
})()