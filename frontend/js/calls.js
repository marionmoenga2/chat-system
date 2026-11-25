/**
 * Voice and video calls for one person or a whole group (WebRTC: everyone connects to everyone).
 * Plugs into chat.js (which must load first): it uses ws, users, onlineSet and currentUser, and wraps
 * handleWebSocketMessage and selectUser. Group chats get their call buttons from groups.js.
 * Optional: define CALL_ICE_SERVERS in config.js to add a TURN server.
 */
(function () {
    'use strict';

    const INVITE_TIMEOUT_MS = 45000;
    const DISCONNECT_GRACE_MS = 12000;
    const MAX_PARTICIPANTS = 6;   // only used for a hint; the server enforces the real limit

    const SVG = (inner, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' + (extra || '') + '>' + inner + '</svg>';
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

    let call = null;       // the call in progress
    let incoming = null;   // an invitation waiting for an answer
    let starting = false;  // true while asking for mic/camera permission
    const $ = (id) => document.getElementById(id);

    const style = document.createElement('style');
    style.textContent = `
        :where(.call-actions) { margin-left: auto; display: flex; gap: 6px; align-items: center; }
        :where(.call-btn) { width: 38px; height: 38px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
        :where(.call-btn svg) { width: 20px; height: 20px; }
        .gc-incoming { position: fixed; inset: 0; z-index: 4000; display: none; align-items: center; justify-content: center; background: rgba(5,10,20,.7); padding: 16px; }
        .gc-incoming.show { display: flex; }
        .gc-card { width: 100%; max-width: 340px; background: #111b2e; color: #e2e8f0; border-radius: 20px; padding: 28px 24px; text-align: center; }
        .gc-av { position: relative; width: 84px; height: 84px; margin: 0 auto 14px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #fff; }
        .gc-av img, .gc-tav img, .gc-addav img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .gc-name { font-size: 1.25rem; font-weight: 700; color: #fff; }
        .gc-kind { margin-top: 4px; color: #94a3b8; font-size: .92rem; }
        .gc-actions { display: flex; justify-content: center; gap: 36px; margin-top: 24px; }
        .gc-action span { display: block; margin-top: 6px; font-size: .8rem; color: #94a3b8; }
        .gc-round { width: 62px; height: 62px; border: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer; }
        .gc-round svg { width: 26px; height: 26px; }
        .gc-round.accept { background: #10b981; } .gc-round.decline { background: #ef4444; }
        .gc-overlay { position: fixed; inset: 0; z-index: 3900; display: none; flex-direction: column; background: #0b1220; color: #fff; }
        .gc-overlay.show { display: flex; }
        .gc-top { text-align: center; padding: 14px 16px 0; }
        .gc-title { font-weight: 700; font-size: 1.1rem; } .gc-status { color: #94a3b8; font-size: .9rem; }
        .gc-stage { flex: 1; min-height: 0; padding: 12px; display: flex; }
        .gc-grid { flex: 1; display: grid; gap: 8px; grid-template-columns: 1fr; grid-auto-rows: 1fr; }
        .gc-grid[data-count="2"], .gc-grid[data-count="3"], .gc-grid[data-count="4"] { grid-template-columns: 1fr 1fr; }
        .gc-grid[data-count="5"], .gc-grid[data-count="6"] { grid-template-columns: 1fr 1fr 1fr; }
        @media (max-width: 640px) { .gc-grid[data-count="5"], .gc-grid[data-count="6"] { grid-template-columns: 1fr 1fr; } }
        .gc-tile { position: relative; background: #1f2937; border-radius: 14px; overflow: hidden; min-height: 0; }
        .gc-tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .gc-tile.local video { transform: scaleX(-1); }
        .gc-tile.no-video video { visibility: hidden; }
        .gc-tav { position: absolute; inset: 0; margin: auto; width: 72px; height: 72px; border-radius: 50%; display: none; align-items: center; justify-content: center; font-size: 1.8rem; overflow: hidden; }
        .gc-tile.no-video .gc-tav { display: flex; }
        .gc-tname { position: absolute; left: 8px; bottom: 8px; padding: 2px 8px; border-radius: 8px; background: rgba(0,0,0,.55); font-size: .8rem; }
        .gc-tstatus { position: absolute; top: 8px; left: 8px; color: #fbbf24; font-size: .75rem; }
        .gc-controls { display: flex; justify-content: center; gap: 14px; padding: 14px 12px calc(14px + env(safe-area-inset-bottom, 0px)); }
        .gc-ctrl { width: 54px; height: 54px; border: 0; border-radius: 50%; background: #1e2b42; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .gc-ctrl svg { width: 24px; height: 24px; }
        .gc-ctrl.off { background: #fff; color: #0b1220; } .gc-ctrl.hangup { background: #ef4444; }
        .gc-add { display: none; position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); width: min(320px, 90vw); max-height: 40vh; overflow-y: auto; background: #111827; border-radius: 14px; padding: 6px; z-index: 2; }
        .gc-add.show { display: block; }
        .gc-addrow { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; border: 0; background: transparent; color: #fff; border-radius: 10px; cursor: pointer; text-align: left; font: inherit; }
        .gc-addrow:hover { background: rgba(255,255,255,.08); }
        .gc-addav { position: relative; width: 32px; height: 32px; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; color: #fff; }
        .gc-addempty { padding: 12px; color: #9ca3af; text-align: center; }
    `;
    document.head.appendChild(style);

    // ---------- Helpers ----------

    function iceServers() {
        if (typeof CALL_ICE_SERVERS !== 'undefined' && Array.isArray(CALL_ICE_SERVERS) && CALL_ICE_SERVERS.length) return CALL_ICE_SERVERS;
        return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
    }
    function supportsCalls() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
    function makeId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
    function hasVideoTrack(stream) { return !!stream && stream.getVideoTracks().length > 0; }
    function nameOf(id) { const u = users.find(x => x.id === id); return u ? u.username : 'Someone'; }
    function wsSend(obj) {
        if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; }
        return false;
    }
    function fmtDuration(total) {
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
        const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
        return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
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
            case 'NotAllowedError': case 'SecurityError': return 'Allow access to your ' + what + ' in the browser, then try again.';
            case 'NotFoundError': case 'OverconstrainedError': return 'No ' + what + ' was found on this device.';
            case 'NotReadableError': return 'Your ' + what + ' is being used by another app.';
            default: return 'Could not access your microphone or camera.';
        }
    }
    function av(id, name) {
        const v = (typeof avatarVersions !== 'undefined' && avatarVersions) ? avatarVersions[String(id)] : null;
        const img = v ? '<img src="' + API_URL + '/api/profile/avatar/' + id + '?v=' + v + '" alt="" onerror="this.remove()">' : '';
        return '<b>' + escapeHtml((name || '?').charAt(0).toUpperCase()) + '</b>' + img;
    }

    const Ringer = {
        ctx: null, timer: null,
        start() {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this.ctx = this.ctx || new AC();
                if (this.ctx.resume) this.ctx.resume();
                const beep = () => {
                    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
                    osc.frequency.value = 480; gain.gain.value = 0.07;
                    osc.connect(gain); gain.connect(this.ctx.destination);
                    osc.start(); osc.stop(this.ctx.currentTime + 0.45);
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
            <div class="gc-incoming" id="gc-incoming" role="alertdialog" aria-live="assertive" aria-label="Incoming call">
                <div class="gc-card">
                    <div class="gc-av" id="gc-inc-av"></div>
                    <div class="gc-name" id="gc-inc-name"></div>
                    <div class="gc-kind" id="gc-inc-kind"></div>
                    <div class="gc-actions">
                        <div class="gc-action"><button type="button" class="gc-round decline" id="gc-decline" aria-label="Decline call">${ICONS.hangup}</button><span>Decline</span></div>
                        <div class="gc-action"><button type="button" class="gc-round accept" id="gc-accept" aria-label="Accept call">${ICONS.phone}</button><span>Accept</span></div>
                    </div>
                </div>
            </div>
            <div class="gc-overlay" id="gc-overlay" role="dialog" aria-label="Call">
                <div class="gc-top"><div class="gc-title" id="gc-title"></div><div class="gc-status" id="gc-status"></div></div>
                <div class="gc-stage"><div class="gc-grid" id="gc-grid"></div></div>
                <div class="gc-add" id="gc-add"></div>
                <div class="gc-controls">
                    <button type="button" class="gc-ctrl" id="gc-mute" aria-label="Mute microphone">${ICONS.mic}</button>
                    <button type="button" class="gc-ctrl" id="gc-camera" aria-label="Turn camera off">${ICONS.video}</button>
                    <button type="button" class="gc-ctrl" id="gc-addbtn" aria-label="Add people">${ICONS.userPlus}</button>
                    <button type="button" class="gc-ctrl hangup" id="gc-hangup" aria-label="Leave call">${ICONS.hangup}</button>
                </div>
            </div>
        `);
        $('gc-accept').addEventListener('click', acceptIncoming);
        $('gc-decline').addEventListener('click', declineIncoming);
        $('gc-mute').addEventListener('click', toggleMute);
        $('gc-camera').addEventListener('click', toggleCamera);
        $('gc-addbtn').addEventListener('click', toggleAddPanel);
        $('gc-hangup').addEventListener('click', () => endCall(true));
        $('gc-add').addEventListener('click', (e) => {
            const row = e.target.closest('.gc-addrow');
            if (!row || !call) return;
            const id = Number(row.dataset.uid);
            addPending(id);
            wsSend({ type: 'call_invite', call_id: call.id, invite_ids: [id] });
            showNotification('Calling ' + nameOf(id) + '...');
            $('gc-add').classList.remove('show');
            updateTitle();
        });
        window.addEventListener('pagehide', () => { if (call) endCall(true); else if (incoming) declineIncoming(); });
    }

    // ---------- Hook into chat.js ----------

    const originalHandleWs = window.handleWebSocketMessage;
    window.handleWebSocketMessage = function (data) {
        switch (data && data.type) {
            case 'call_invite': onInvite(data); return;
            case 'call_joined': onJoined(data); return;
            case 'call_participant_joined': onParticipantJoined(data); return;
            case 'call_participant_left': onParticipantLeft(data); return;
            case 'call_declined': onDeclined(data); return;
            case 'call_unavailable': onUnavailable(data); return;
            case 'call_full': showNotification(data.max ? 'This call is full (max ' + data.max + ' people)' : 'This call is full'); return;
            case 'call_ended': onEnded(data); return;
            case 'call_offer': onOffer(data); return;
            case 'call_answer': onAnswer(data); return;
            case 'call_ice': onIce(data); return;
            case 'call_media': onMedia(data); return;
        }
        return originalHandleWs(data);
    };

    function placeButtons(onClick) {
        const header = $('chat-header');
        if (!header || header.querySelector('.call-actions') || !supportsCalls()) return;
        const box = document.createElement('div');
        box.className = 'call-actions';
        box.innerHTML = '<button type="button" class="call-btn" data-video="0" title="Voice call" aria-label="Voice call">' + ICONS.phone + '</button>'
            + '<button type="button" class="call-btn" data-video="1" title="Video call" aria-label="Video call">' + ICONS.video + '</button>';
        box.addEventListener('click', (e) => {
            const b = e.target.closest('.call-btn');
            if (b) onClick(b.dataset.video === '1');
        });
        header.appendChild(box);
    }

    const originalSelectUser = window.selectUser;
    window.selectUser = function (user) {
        const result = originalSelectUser(user);
        placeButtons((video) => startCall([user.id], video));
        return result;
    };

    window.addGroupCallButtons = function (groupId, groupName) {
        placeButtons((video) => startGroupCall(groupId, groupName, video));
    };
    window.startGroupCall = startGroupCall;

    // ---------- Call state ----------

    function newCall(id, video, stream, state, title) {
        return { id: id, video: video, state: state, title: title || '', localStream: stream, peers: new Map(), pending: new Set(),
                 muted: false, cameraOff: false, startedAt: 0, timer: null, localTile: null };
    }

    function addPending(id) {
        const c = call;
        c.pending.add(id);
        setTimeout(() => {
            if (call === c && c.pending.has(id)) {
                c.pending.delete(id);
                showNotification(nameOf(id) + ' did not answer');
                updateTitle();
                checkAlone();
            }
        }, INVITE_TIMEOUT_MS);
    }

    function checkAlone() {
        if (call && call.peers.size === 0 && call.pending.size === 0) endCall(true);
    }

    // ---------- Starting a call ----------

    async function startGroupCall(groupId, groupName, video) {
        if (call || incoming || starting) { showNotification('You are already in a call'); return; }
        const info = await apiGet('/api/groups/' + groupId);
        if (!info || !info.members) { showNotification('Could not load the group'); return; }
        const ids = info.members.map(m => m.id).filter(id => id !== currentUser.id);
        startCall(ids, video, groupName);
    }

    async function startCall(targetIds, video, title) {
        if (call || incoming || starting) { showNotification('You are already in a call'); return; }
        if (!ws || ws.readyState !== WebSocket.OPEN) { showNotification('Not connected yet. Try again in a moment.'); return; }
        const online = targetIds.filter(id => onlineSet.has(id));
        if (!online.length) {
            showNotification(title ? 'Nobody else in this group is online' : nameOf(targetIds[0]) + ' is offline');
            return;
        }
        starting = true;
        let stream;
        try { stream = await getMedia(video); }
        catch (err) { starting = false; showNotification(mediaErrorMessage(err, video)); return; }
        starting = false;

        call = newCall(makeId(), video, stream, 'calling', title);
        showCallUi();
        setStatus('Calling...');
        online.forEach(addPending);
        updateTitle();
        wsSend({ type: 'call_start', call_id: call.id, video: video, title: title || '', invite_ids: online });
    }

    // ---------- Receiving an invitation ----------

    function onInvite(data) {
        if (call || incoming || starting) { wsSend({ type: 'call_decline', call_id: data.call_id }); return; }
        incoming = data;
        const kind = data.video ? 'video' : 'voice';
        const others = (data.participants || []).map(p => p.username);
        const a = $('gc-inc-av');
        a.style.background = avatarGradient(data.from_username);
        a.innerHTML = av(data.from_id, data.from_username);
        $('gc-inc-name').textContent = data.from_username;
        $('gc-inc-kind').textContent = data.title ? 'Group ' + kind + ' call \u00b7 ' + data.title
            : (others.length > 1 ? 'Group ' + kind + ' call with ' + others.join(', ') : 'Incoming ' + kind + ' call');
        $('gc-accept').innerHTML = data.video ? ICONS.video : ICONS.phone;
        $('gc-incoming').classList.add('show');
        Ringer.start();
        incoming.timeout = setTimeout(() => {
            if (incoming && incoming.call_id === data.call_id) {
                showNotification('Missed call from ' + data.from_username);
                wsSend({ type: 'call_decline', call_id: data.call_id });
                clearIncoming();
            }
        }, INVITE_TIMEOUT_MS);
    }

    function clearIncoming() {
        if (incoming) clearTimeout(incoming.timeout);
        incoming = null;
        $('gc-incoming').classList.remove('show');
        Ringer.stop();
    }

    function declineIncoming() {
        if (!incoming) return;
        wsSend({ type: 'call_decline', call_id: incoming.call_id });
        clearIncoming();
    }

    async function acceptIncoming() {
        if (!incoming) return;
        const inv = incoming;
        $('gc-incoming').classList.remove('show');
        Ringer.stop();
        clearTimeout(inv.timeout);

        let stream;
        try { stream = await getMedia(!!inv.video); }
        catch (err) {
            showNotification(mediaErrorMessage(err, !!inv.video));
            wsSend({ type: 'call_decline', call_id: inv.call_id });
            incoming = null;
            return;
        }
        if (!incoming || incoming.call_id !== inv.call_id) { stream.getTracks().forEach(t => t.stop()); return; }
        incoming = null;

        call = newCall(inv.call_id, !!inv.video, stream, 'connecting', inv.title);
        showCallUi();
        setStatus('Connecting...');
        wsSend({ type: 'call_join', call_id: call.id });
    }

    // ---------- Peers ----------

    function createPeer(uid, name) {
        const existing = call.peers.get(uid);
        if (existing) return existing;

        const pc = new RTCPeerConnection({ iceServers: iceServers() });
        const peer = { id: uid, name: name, pc: pc, stream: new MediaStream(), tile: makeTile(uid, name, false), pendingIce: [], camOff: false, dropTimer: null };
        call.peers.set(uid, peer);
        layoutGrid();
        updateTitle();
        call.localStream.getTracks().forEach(track => pc.addTrack(track, call.localStream));

        pc.onicecandidate = (e) => {
            if (e.candidate && call && call.peers.get(uid) === peer) {
                wsSend({ type: 'call_ice', receiver_id: uid, call_id: call.id, candidate: e.candidate.toJSON() });
            }
        };
        pc.ontrack = (e) => {
            if (!call || call.peers.get(uid) !== peer) return;
            peer.stream.addTrack(e.track);
            updateTile(peer);
        };
        pc.onconnectionstatechange = () => {
            if (!call || call.peers.get(uid) !== peer) return;
            const state = pc.connectionState;
            if (state === 'connected') {
                clearTimeout(peer.dropTimer);
                setTileStatus(peer, '');
                onConnected();
            } else if (state === 'disconnected') {
                setTileStatus(peer, 'Reconnecting...');
                clearTimeout(peer.dropTimer);
                peer.dropTimer = setTimeout(() => {
                    if (call && call.peers.get(uid) === peer && pc.connectionState !== 'connected') {
                        showNotification('Lost connection to ' + peer.name);
                        removePeer(uid);
                        checkAlone();
                    }
                }, DISCONNECT_GRACE_MS);
            } else if (state === 'failed') {
                showNotification('Could not connect to ' + peer.name + '. Their network may block direct calls.');
                removePeer(uid);
                checkAlone();
            }
        };
        return peer;
    }

    function removePeer(uid) {
        const peer = call && call.peers.get(uid);
        if (!peer) return;
        call.peers.delete(uid);
        clearTimeout(peer.dropTimer);
        peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null;
        try { peer.pc.close(); } catch (e) { /* already closed */ }
        peer.tile.remove();
        layoutGrid();
        updateTitle();
    }

    async function flushIce(peer) {
        const list = peer.pendingIce;
        peer.pendingIce = [];
        for (const candidate of list) {
            try { await peer.pc.addIceCandidate(candidate); } catch (err) { console.error('ICE error:', err); }
        }
    }

    function onConnected() {
        if (!call || call.state === 'connected') return;
        call.state = 'connected';
        call.startedAt = Date.now();
        Ringer.stop();
        setStatus('00:00');
        call.timer = setInterval(() => {
            if (call && call.state === 'connected') setStatus(fmtDuration(Math.floor((Date.now() - call.startedAt) / 1000)));
        }, 1000);
    }

    // ---------- Messages from the server ----------

    async function onJoined(data) {
        if (!call || call.id !== data.call_id) return;
        for (const p of (data.participants || [])) {
            if (!call || call.id !== data.call_id) return;
            if (p.user_id === currentUser.id) continue;
            const peer = createPeer(p.user_id, p.username);
            try {
                const offer = await peer.pc.createOffer();
                await peer.pc.setLocalDescription(offer);
                wsSend({ type: 'call_offer', receiver_id: p.user_id, call_id: call.id, video: call.video, sdp: { type: offer.type, sdp: offer.sdp } });
            } catch (err) {
                console.error('Could not connect to', p.username, err);
                removePeer(p.user_id);
            }
        }
        checkAlone();
    }

    function onParticipantJoined(data) {
        if (!call || call.id !== data.call_id) return;
        call.pending.delete(data.user_id);
        createPeer(data.user_id, data.username);
        showNotification(data.username + ' joined');
    }

    function onParticipantLeft(data) {
        if (!call || call.id !== data.call_id) return;
        const peer = call.peers.get(data.user_id);
        if (peer) showNotification(peer.name + ' left the call');
        removePeer(data.user_id);
        checkAlone();
    }

    function onDeclined(data) {
        if (!call || call.id !== data.call_id) return;
        call.pending.delete(data.user_id);
        showNotification(nameOf(data.user_id) + ' declined the call');
        updateTitle();
        checkAlone();
    }

    function onUnavailable(data) {
        if (!call || data.call_id !== call.id) return;
        call.pending.delete(data.from_id);
        showNotification(nameOf(data.from_id) + ' is offline');
        updateTitle();
        checkAlone();
    }

    function onEnded(data) {
        if (incoming && data.call_id === incoming.call_id) {
            showNotification('Missed call from ' + incoming.from_username);
            clearIncoming();
            return;
        }
        if (call && call.id === data.call_id) {
            if (call.peers.size > 0) showNotification('The call ended');
            endCall(false);
        }
    }

    async function onOffer(data) {
        if (!call || call.id !== data.call_id || !data.sdp) return;
        const peer = createPeer(data.from_id, data.from_username);
        try {
            await peer.pc.setRemoteDescription(data.sdp);
            await flushIce(peer);
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            wsSend({ type: 'call_answer', receiver_id: data.from_id, call_id: call.id, sdp: { type: answer.type, sdp: answer.sdp } });
        } catch (err) {
            console.error('Could not answer', err);
            removePeer(data.from_id);
            checkAlone();
        }
    }

    async function onAnswer(data) {
        if (!call || call.id !== data.call_id || !data.sdp) return;
        const peer = call.peers.get(data.from_id);
        if (!peer) return;
        try {
            await peer.pc.setRemoteDescription(data.sdp);
            await flushIce(peer);
        } catch (err) {
            console.error('Bad answer:', err);
            removePeer(data.from_id);
            checkAlone();
        }
    }

    function onIce(data) {
        if (!data.candidate || !call || call.id !== data.call_id) return;
        const peer = call.peers.get(data.from_id);
        if (!peer) return;
        if (peer.pc.remoteDescription) peer.pc.addIceCandidate(data.candidate).catch(err => console.error('ICE error:', err));
        else peer.pendingIce.push(data.candidate);
    }

    function onMedia(data) {
        if (!call || data.call_id !== call.id) return;
        const peer = call.peers.get(data.from_id);
        if (!peer) return;
        peer.camOff = data.video === false;
        updateTile(peer);
    }

    // ---------- Call screen ----------

    function makeTile(id, name, isLocal) {
        const tile = document.createElement('div');
        tile.className = 'gc-tile no-video' + (isLocal ? ' local' : '');
        tile.innerHTML = '<video autoplay playsinline></video>'
            + '<div class="gc-tav" style="background:' + avatarGradient(name) + '">' + av(id, name) + '</div>'
            + '<div class="gc-tname">' + (isLocal ? 'You' : escapeHtml(name)) + '</div><div class="gc-tstatus"></div>';
        if (isLocal) tile.querySelector('video').muted = true;
        $('gc-grid').appendChild(tile);
        return tile;
    }

    function updateTile(peer) {
        peer.tile.classList.toggle('no-video', !(hasVideoTrack(peer.stream) && !peer.camOff));
        const v = peer.tile.querySelector('video');
        if (v.srcObject !== peer.stream) v.srcObject = peer.stream;
        if (v.play) v.play().catch(() => {});
    }

    function setTileStatus(peer, text) { peer.tile.querySelector('.gc-tstatus').textContent = text; }
    function layoutGrid() { $('gc-grid').dataset.count = String($('gc-grid').children.length); }
    function setStatus(text) { $('gc-status').textContent = text; }

    function showCallUi() {
        $('gc-grid').innerHTML = '';
        call.localTile = makeTile(currentUser.id, currentUser.username, true);
        call.localTile.querySelector('video').srcObject = call.localStream;
        call.localTile.classList.toggle('no-video', !hasVideoTrack(call.localStream));
        layoutGrid();
        updateTitle();
        $('gc-camera').style.display = hasVideoTrack(call.localStream) ? '' : 'none';
        $('gc-mute').classList.remove('off'); $('gc-mute').innerHTML = ICONS.mic;
        $('gc-camera').classList.remove('off'); $('gc-camera').innerHTML = ICONS.video;
        $('gc-add').classList.remove('show');
        $('gc-overlay').classList.add('show');
    }

    function updateTitle() {
        if (!call) return;
        const names = Array.from(call.peers.values()).map(p => p.name);
        let title;
        if (call.title) title = call.title;
        else if (names.length === 0) { const w = Array.from(call.pending).map(nameOf); title = w.length ? w.join(', ') : 'Call'; }
        else if (names.length === 1) title = names[0];
        else title = 'Group call (' + (names.length + 1) + ')';
        $('gc-title').textContent = title;
    }

    function toggleMute() {
        if (!call) return;
        const tracks = call.localStream.getAudioTracks();
        if (!tracks.length) return;
        call.muted = !call.muted;
        tracks.forEach(t => { t.enabled = !call.muted; });
        const b = $('gc-mute');
        b.classList.toggle('off', call.muted);
        b.innerHTML = call.muted ? ICONS.micOff : ICONS.mic;
        b.setAttribute('aria-label', call.muted ? 'Unmute microphone' : 'Mute microphone');
    }

    function toggleCamera() {
        if (!call) return;
        const tracks = call.localStream.getVideoTracks();
        if (!tracks.length) return;
        call.cameraOff = !call.cameraOff;
        tracks.forEach(t => { t.enabled = !call.cameraOff; });
        const b = $('gc-camera');
        b.classList.toggle('off', call.cameraOff);
        b.innerHTML = call.cameraOff ? ICONS.videoOff : ICONS.video;
        b.setAttribute('aria-label', call.cameraOff ? 'Turn camera on' : 'Turn camera off');
        call.localTile.classList.toggle('no-video', call.cameraOff);
        call.peers.forEach(peer => wsSend({ type: 'call_media', receiver_id: peer.id, call_id: call.id, video: !call.cameraOff }));
    }

    function toggleAddPanel() {
        const panel = $('gc-add');
        if (!call) return;
        if (panel.classList.contains('show')) { panel.classList.remove('show'); return; }
        if (call.peers.size + call.pending.size + 1 >= MAX_PARTICIPANTS) {
            showNotification('This call may be full (about ' + MAX_PARTICIPANTS + ' people)');
        }
        const free = users.filter(u => onlineSet.has(u.id) && !call.peers.has(u.id) && !call.pending.has(u.id));
        panel.innerHTML = free.length
            ? free.map(u => '<button type="button" class="gc-addrow" data-uid="' + u.id + '"><span class="gc-addav" style="background:' + avatarGradient(u.username) + '">' + av(u.id, u.username) + '</span><span>' + escapeHtml(u.username) + '</span></button>').join('')
            : '<div class="gc-addempty">Nobody else is online</div>';
        panel.classList.add('show');
    }

    function endCall(tell) {
        if (!call) return;
        const c = call;
        call = null;
        if (tell) wsSend({ type: 'call_leave', call_id: c.id });
        clearInterval(c.timer);
        c.peers.forEach(peer => {
            clearTimeout(peer.dropTimer);
            peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null;
            try { peer.pc.close(); } catch (e) { /* already closed */ }
        });
        c.localStream.getTracks().forEach(t => t.stop());
        $('gc-grid').innerHTML = '';
        $('gc-add').classList.remove('show');
        $('gc-overlay').classList.remove('show');
        Ringer.stop();
    }

    function init() { injectUi(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
