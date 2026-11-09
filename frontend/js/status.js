/**
 * Status updates: post a text or photo status that everyone can see for 24 hours.
 * Loads after chat.js. Needs API_URL (config.js) and the chat.js helpers.
 */
(function () {
    'use strict';

    const SHOW_MS = 5000;
    const COLORS = ['#0f6b4f', '#1f4fd8', '#7c3aed', '#be185d', '#c2410c', '#0f172a'];
    const $ = (id) => document.getElementById(id);

    let feed = [];
    const imageCache = {};
    let viewer = null;
    let compose = { bg: COLORS[0], image: null };
    let posting = false;

    const style = document.createElement('style');
    style.textContent = `
        .st-strip { padding: 10px 12px 0; }
        .st-strip-btn { width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid #d5ddea;
            border-radius: 12px; background: #fff; color: #14213a; font: inherit; text-align: left; cursor: pointer; }
        .st-strip-btn:hover { background: #f4f7fc; }
        .st-strip-btn small { display: block; color: #5b6b82; font-size: .78rem; }
        .st-badge { margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; background: #1f4fd8;
            color: #fff; font-size: .75rem; font-weight: 700; display: none; align-items: center; justify-content: center; }
        .st-badge.on { display: inline-flex; }
        .st-av { position: relative; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
            overflow: hidden; color: #fff; flex-shrink: 0; }
        .st-av b { font-size: .95em; }
        .st-av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .st-ring { display: inline-flex; padding: 3px; border-radius: 50%; border: 3px solid #10b981; flex-shrink: 0; }
        .st-ring.seen { border-color: #c3ccd8; }
        .st-ring.none { border-color: #d5ddea; border-style: dashed; }
        .st-modal { position: fixed; inset: 0; z-index: 3300; display: none; align-items: center; justify-content: center;
            padding: 16px; background: rgba(10,20,40,.55); }
        .st-modal.open { display: flex; }
        .st-card { width: 100%; max-width: 420px; max-height: 88vh; overflow-y: auto; background: #fff; color: #14213a;
            border-radius: 16px; padding: 18px; box-shadow: 0 24px 48px -16px rgba(0,0,0,.5); }
        .st-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .st-head strong { font-size: 1.15rem; }
        .st-x { border: 0; background: transparent; font-size: 1.6rem; line-height: 1; cursor: pointer; color: #5b6b82; padding: 2px 8px; }
        .st-sub { margin: 14px 0 6px; font-size: .78rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #5b6b82; }
        .st-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 8px 6px; border: 0; background: transparent;
            border-radius: 10px; font: inherit; color: inherit; text-align: left; cursor: pointer; }
        .st-row:hover { background: #f4f7fc; }
        .st-row small { display: block; color: #5b6b82; font-size: .8rem; }
        .st-btn { font: inherit; font-size: .9rem; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 10px;
            background: #1f4fd8; color: #fff; cursor: pointer; }
        .st-btn:hover { background: #1840b3; }
        .st-btn:disabled { opacity: .65; cursor: wait; }
        .st-btn.ghost { background: #eef2f9; color: #33425b; }
        .st-btn.ghost:hover { background: #e1e8f4; }
        .st-btn.small { padding: 6px 12px; font-size: .82rem; margin-left: auto; }
        .st-empty { padding: 18px 6px; color: #5b6b82; text-align: center; font-size: .92rem; }
        .st-preview { position: relative; height: 280px; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .st-preview textarea { width: 100%; height: 100%; padding: 24px; border: 0; background: transparent; color: #fff; resize: none;
            font: inherit; font-size: 1.4rem; text-align: center; display: flex; }
        .st-preview textarea::placeholder { color: rgba(255,255,255,.7); }
        .st-preview textarea:focus { outline: none; }
        .st-preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
        .st-preview.has-img textarea { position: absolute; left: 0; right: 0; bottom: 0; height: 74px; padding: 12px; font-size: 1rem;
            background: rgba(0,0,0,.55); }
        .st-swatches { display: flex; gap: 8px; margin: 12px 0; }
        .st-swatches button { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #c3ccd8; cursor: pointer; }
        .st-swatches button.on { box-shadow: 0 0 0 2px #14213a; }
        .st-crow { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        .st-crow.end { justify-content: flex-end; margin-top: 14px; }
        .st-note { margin: 10px 0 0; color: #5b6b82; font-size: .82rem; }
        .st-err { min-height: 1.1rem; margin-top: 6px; color: #b42318; font-size: .85rem; }
        .st-viewer { position: fixed; inset: 0; z-index: 3600; display: none; align-items: center; justify-content: center; background: #05080f; }
        .st-viewer.open { display: flex; }
        .st-vbox { position: relative; width: 100%; max-width: 440px; height: 100%; max-height: 820px; background: #111; overflow: hidden; }
        .st-bars { position: absolute; top: 10px; left: 10px; right: 10px; z-index: 5; display: flex; gap: 4px; }
        .st-bars i { flex: 1; height: 3px; border-radius: 3px; background: rgba(255,255,255,.35); overflow: hidden; }
        .st-bars i.done { background: #fff; }
        .st-bars u { display: block; height: 100%; width: 0; background: #fff; }
        .st-bars u.run { animation: st-fill ${SHOW_MS}ms linear forwards; }
        @keyframes st-fill { to { width: 100%; } }
        .st-vhead { position: absolute; top: 22px; left: 12px; right: 8px; z-index: 5; display: flex; align-items: center; gap: 10px; color: #fff; }
        .st-vhead small { display: block; opacity: .75; font-size: .78rem; }
        .st-vhead .st-x { margin-left: auto; color: #fff; }
        .st-vbody { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
        .st-vtext { padding: 28px; color: #fff; font-size: 1.7rem; line-height: 1.35; text-align: center; word-break: break-word; white-space: pre-wrap; }
        .st-vimg { max-width: 100%; max-height: 100%; object-fit: contain; }
        .st-vcap { position: absolute; left: 0; right: 0; bottom: 70px; padding: 14px 18px; background: rgba(0,0,0,.55); color: #fff; text-align: center; white-space: pre-wrap; word-break: break-word; }
        .st-vload { color: #fff; opacity: .8; }
        .st-nav { position: absolute; top: 70px; bottom: 90px; width: 35%; border: 0; background: transparent; cursor: pointer; z-index: 4; }
        .st-nav.prev { left: 0; } .st-nav.next { right: 0; }
        .st-vfoot { position: absolute; left: 0; right: 0; bottom: 0; z-index: 6; display: flex; gap: 8px; justify-content: center; padding: 14px; }
        .st-vfoot .st-btn { background: rgba(255,255,255,.18); }
        .st-vfoot .st-btn:hover { background: rgba(255,255,255,.3); }
        .st-viewers { position: absolute; left: 0; right: 0; bottom: 0; z-index: 8; display: none; max-height: 60%; overflow-y: auto;
            background: #fff; color: #14213a; border-radius: 16px 16px 0 0; padding: 16px; }
        .st-viewers.open { display: block; }
        .st-vfoot { flex-wrap: wrap; }
        .st-vfoot .st-btn.liked { background: #e11d48; color: #fff; }
        .st-cform { display: flex; gap: 8px; margin-top: 12px; position: sticky; bottom: 0; background: #fff; padding-top: 8px; }
        .st-cform input { flex: 1; min-width: 0; height: 42px; padding: 0 12px; border: 1px solid #cdd6e4; border-radius: 10px; font: inherit; font-size: 1rem; }
        .st-cform input:focus { outline: none; border-color: #1f4fd8; box-shadow: 0 0 0 3px rgba(31,79,216,.18); }
    `;
    document.head.appendChild(style);

    function notify(m) { if (typeof showNotification === 'function') showNotification(m); }

    async function api(method, path, body) {
        const token = localStorage.getItem('token');
        if (!token || typeof API_URL === 'undefined') return { ok: false, status: 0, data: null };
        try {
            const res = await fetch(API_URL + '/api/status' + path, {
                method: method,
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            });
            let data = null;
            try { data = await res.json(); } catch (e) { /* no body */ }
            return { ok: res.ok, status: res.status, data: data };
        } catch (e) {
            return { ok: false, status: 0, data: null };
        }
    }

    function ago(iso) {
        const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
        if (s < 60) return 'Just now';
        if (s < 3600) return Math.floor(s / 60) + ' min ago';
        if (s < 86400) return Math.floor(s / 3600) + ' h ago';
        return 'Yesterday';
    }

    function avatar(id, name, size) {
        const v = (typeof avatarVersions !== 'undefined' && avatarVersions) ? avatarVersions[String(id)] : null;
        const img = v ? '<img src="' + API_URL + '/api/profile/avatar/' + id + '?v=' + v + '" alt="" onerror="this.remove()">' : '';
        const bg = (typeof avatarGradient === 'function') ? avatarGradient(name) : '#64748b';
        const initial = escapeHtml((name || '?').charAt(0).toUpperCase());
        return '<span class="st-av" style="width:' + size + 'px;height:' + size + 'px;background:' + bg + '"><b>' + initial + '</b>' + img + '</span>';
    }

    function groupOf(userId) { return feed.find(g => g.user_id === userId); }
    function myGroup() { return feed.find(g => g.is_me); }
    function unviewedCount() {
        return feed.filter(g => !g.is_me).reduce((n, g) => n + g.items.filter(i => !i.viewed).length, 0);
    }

    // ---------- Page pieces ----------

    function build() {
        const strip = document.createElement('div');
        strip.className = 'st-strip';
        strip.innerHTML = '<button type="button" class="st-strip-btn" id="st-open">'
            + '<span class="st-ring none" id="st-strip-ring"><span class="st-av" style="width:34px;height:34px;background:#1f4fd8;font-size:1.2rem"><b>+</b></span></span>'
            + '<span>Status<small id="st-strip-sub">Share an update</small></span>'
            + '<span class="st-badge" id="st-badge"></span></button>';

        const search = $('user-search');
        if (search && search.parentElement) {
            const host = search.parentElement;
            const list = $('users-list');
            const anchor = (list && host.contains(list)) ? search : host;
            anchor.parentElement.insertBefore(strip, anchor);
        } else {
            strip.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2000;width:240px';
            document.body.appendChild(strip);
        }

        document.body.insertAdjacentHTML('beforeend', `
            <div class="st-modal" id="st-list" role="dialog" aria-modal="true" aria-label="Status updates">
                <div class="st-card"><div class="st-head"><strong>Status</strong><button type="button" class="st-x" id="st-list-close" aria-label="Close">&times;</button></div>
                <div id="st-list-body"></div></div>
            </div>
            <div class="st-modal" id="st-comp" role="dialog" aria-modal="true" aria-label="New status">
                <div class="st-card">
                    <div class="st-head"><strong>New status</strong><button type="button" class="st-x" id="st-comp-close" aria-label="Close">&times;</button></div>
                    <div class="st-preview" id="st-preview"><textarea id="st-text" maxlength="500" placeholder="Type a status"></textarea><img id="st-pimg" alt="" hidden></div>
                    <div class="st-swatches" id="st-swatches"></div>
                    <div class="st-crow">
                        <button type="button" class="st-btn ghost" id="st-photo">Add photo</button>
                        <button type="button" class="st-btn ghost" id="st-rmphoto" hidden>Remove photo</button>
                        <input type="file" id="st-file" accept="image/*" hidden>
                    </div>
                    <p class="st-note">Everyone on ChatWave can see it for 24 hours.</p>
                    <div class="st-err" id="st-err" role="alert"></div>
                    <div class="st-crow end"><button type="button" class="st-btn ghost" id="st-cancel">Cancel</button><button type="button" class="st-btn" id="st-post">Post</button></div>
                </div>
            </div>
            <div class="st-viewer" id="st-viewer" role="dialog" aria-modal="true" aria-label="Status viewer">
                <div class="st-vbox">
                    <div class="st-bars" id="st-bars"></div>
                    <div class="st-vhead"><span id="st-vwho" style="display:flex;align-items:center;gap:10px"></span><button type="button" class="st-x" id="st-vclose" aria-label="Close">&times;</button></div>
                    <div class="st-vbody" id="st-vbody"></div>
                    <button type="button" class="st-nav prev" id="st-prev" aria-label="Previous"></button>
                    <button type="button" class="st-nav next" id="st-next" aria-label="Next"></button>
                    <div class="st-vfoot" id="st-vfoot"></div>
                    <div class="st-viewers" id="st-viewers"></div>
                </div>
            </div>
        `);

        $('st-swatches').innerHTML = COLORS.map(c => '<button type="button" data-c="' + c + '" style="background:' + c + '" aria-label="Background color"></button>').join('');

        $('st-open').addEventListener('click', openList);
        $('st-list-close').addEventListener('click', closeList);
        $('st-list').addEventListener('click', (e) => { if (e.target.id === 'st-list') closeList(); });
        $('st-list-body').addEventListener('click', onListClick);
        $('st-comp-close').addEventListener('click', closeComposer);
        $('st-cancel').addEventListener('click', closeComposer);
        $('st-swatches').addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (b) { compose.bg = b.dataset.c; paintComposer(); }
        });
        $('st-photo').addEventListener('click', () => $('st-file').click());
        $('st-file').addEventListener('change', onPhotoChosen);
        $('st-rmphoto').addEventListener('click', () => { compose.image = null; $('st-file').value = ''; paintComposer(); });
        $('st-post').addEventListener('click', postStatus);
        $('st-vclose').addEventListener('click', closeViewer);
        $('st-next').addEventListener('click', next);
        $('st-prev').addEventListener('click', prev);
        $('st-vfoot').addEventListener('click', onFootClick);
        document.addEventListener('keydown', (e) => {
            if (viewer) {
                const typing = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
                if (e.key === 'Escape') closeViewer();
                else if (!typing && e.key === 'ArrowRight') next();
                else if (!typing && e.key === 'ArrowLeft') prev();
            } else if (e.key === 'Escape') {
                if ($('st-comp').classList.contains('open')) closeComposer();
                else if ($('st-list').classList.contains('open')) closeList();
            }
        });
    }

    function paintStrip() {
        const n = unviewedCount();
        const badge = $('st-badge');
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.toggle('on', n > 0);
        $('st-strip-sub').textContent = n > 0 ? n + ' new update' + (n === 1 ? '' : 's') : 'See what people are sharing';
    }

    // ---------- Feed ----------

    async function loadFeed() {
        const r = await api('GET', '');
        if (!r.ok || !r.data) return;
        feed = r.data.groups || [];
        paintStrip();
        if ($('st-list').classList.contains('open')) renderList();
    }

    // ---------- List ----------

    function openList() { renderList(); $('st-list').classList.add('open'); loadFeed(); }
    function closeList() { $('st-list').classList.remove('open'); }

    function renderList() {
        const me = myGroup();
        const meName = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : 'Me';
        const meId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : 0;
        let html = '<button type="button" class="st-row" data-open="me"><span class="st-ring ' + (me ? '' : 'none') + '">' + avatar(meId, meName, 44) + '</span>'
            + '<span><strong>My status</strong><small>' + (me ? me.items.length + ' update' + (me.items.length === 1 ? '' : 's') + ' &middot; ' + ago(me.items[me.items.length - 1].created_at) : 'Tap to add a status') + '</small></span>'
            + '<span class="st-btn small" data-add="1">Add</span></button>';

        const others = feed.filter(g => !g.is_me);
        const newer = others.filter(g => g.items.some(i => !i.viewed));
        const seen = others.filter(g => !g.items.some(i => !i.viewed));
        const row = (g, isSeen) => '<button type="button" class="st-row" data-open="' + g.user_id + '"><span class="st-ring ' + (isSeen ? 'seen' : '') + '">' + avatar(g.user_id, g.username, 44) + '</span>'
            + '<span><strong>' + escapeHtml(g.username) + '</strong><small>' + ago(g.items[g.items.length - 1].created_at) + '</small></span></button>';

        if (newer.length) html += '<div class="st-sub">Recent updates</div>' + newer.map(g => row(g, false)).join('');
        if (seen.length) html += '<div class="st-sub">Viewed</div>' + seen.map(g => row(g, true)).join('');
        if (!others.length) html += '<div class="st-empty">No one else has shared a status yet.</div>';
        $('st-list-body').innerHTML = html;
    }

    function onListClick(e) {
        if (e.target.closest('[data-add]')) { openComposer(); return; }
        const btn = e.target.closest('[data-open]');
        if (!btn) return;
        if (btn.dataset.open === 'me') {
            const me = myGroup();
            if (me) openViewer(me); else openComposer();
        } else {
            const g = groupOf(Number(btn.dataset.open));
            if (g) openViewer(g);
        }
    }

    // ---------- Composer ----------

    function openComposer() {
        compose = { bg: COLORS[0], image: null };
        $('st-text').value = '';
        $('st-err').textContent = '';
        $('st-file').value = '';
        paintComposer();
        $('st-comp').classList.add('open');
        $('st-text').focus();
    }
    function closeComposer() { $('st-comp').classList.remove('open'); }

    function paintComposer() {
        const prev = $('st-preview');
        prev.style.background = compose.bg;
        prev.classList.toggle('has-img', !!compose.image);
        const img = $('st-pimg');
        img.hidden = !compose.image;
        if (compose.image) img.src = compose.image;
        $('st-text').placeholder = compose.image ? 'Add a caption (optional)' : 'Type a status';
        $('st-rmphoto').hidden = !compose.image;
        $('st-photo').textContent = compose.image ? 'Change photo' : 'Add photo';
        $('st-swatches').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === compose.bg));
    }

    function resizePhoto(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read that file'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('That file is not a valid image'));
                img.onload = () => {
                    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
                    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    let q = 0.8, out = c.toDataURL('image/jpeg', q);
                    while (out.length > 350000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
                    if (out.length > 440000) reject(new Error('That photo is too large'));
                    else resolve(out);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function onPhotoChosen(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { $('st-err').textContent = 'Please choose an image file.'; return; }
        try {
            compose.image = await resizePhoto(file);
            $('st-err').textContent = '';
            paintComposer();
        } catch (err) {
            $('st-err').textContent = err.message;
        }
    }

    async function postStatus() {
        if (posting) return;
        const text = $('st-text').value.trim();
        if (!text && !compose.image) { $('st-err').textContent = 'Write something or add a photo.'; return; }
        posting = true;
        const btn = $('st-post');
        btn.disabled = true;
        btn.textContent = 'Posting...';
        const r = await api('POST', '', { text: text, image: compose.image, bg: compose.bg });
        posting = false;
        btn.disabled = false;
        btn.textContent = 'Post';
        if (r.ok) {
            closeComposer();
            notify('Status posted');
            await loadFeed();
        } else {
            const d = r.data && r.data.detail;
            $('st-err').textContent = typeof d === 'string' ? d : 'Could not post your status. Please try again.';
        }
    }

    // ---------- Viewer ----------

    function openViewer(group) {
        let start = group.items.findIndex(i => !i.viewed);
        if (group.is_me || start < 0) start = 0;
        viewer = { group: group, i: start, timer: null, n: 0 };
        closeList();
        $('st-viewers').classList.remove('open');
        $('st-viewer').classList.add('open');
        showItem();
    }

    function closeViewer() {
        if (viewer) clearTimeout(viewer.timer);
        viewer = null;
        $('st-viewer').classList.remove('open');
        $('st-viewers').classList.remove('open');
        loadFeed();
    }

    function startTimer(n) {
        if (!viewer || viewer.n !== n) return;
        const fill = $('st-fill');
        if (fill) fill.classList.add('run');
        clearTimeout(viewer.timer);
        viewer.timer = setTimeout(next, SHOW_MS);
    }

    async function showItem() {
        clearTimeout(viewer.timer);
        const n = ++viewer.n;
        const g = viewer.group;
        const item = g.items[viewer.i];

        $('st-bars').innerHTML = g.items.map((_, k) => '<i class="' + (k < viewer.i ? 'done' : '') + '">' + (k === viewer.i ? '<u id="st-fill"></u>' : '') + '</i>').join('');
        $('st-vwho').innerHTML = avatar(g.user_id, g.username, 36) + '<span><strong>' + escapeHtml(g.is_me ? 'My status' : g.username) + '</strong><small>' + ago(item.created_at) + '</small></span>';
        paintFoot();
        $('st-viewers').classList.remove('open');

        if (!g.is_me && !item.viewed) {
            item.viewed = true;
            api('POST', '/' + item.id + '/view');
            paintStrip();
        }

        const body = $('st-vbody');
        if (item.kind === 'image') {
            body.style.background = '#000';
            body.innerHTML = '<div class="st-vload">Loading...</div>';
            let src = imageCache[item.id];
            if (!src) {
                const r = await api('GET', '/' + item.id + '/image');
                if (r.ok && r.data && r.data.image) { src = r.data.image; imageCache[item.id] = src; }
            }
            if (!viewer || viewer.n !== n) return;
            body.innerHTML = src
                ? '<img class="st-vimg" src="' + src + '" alt="">' + (item.text ? '<div class="st-vcap">' + escapeHtml(item.text) + '</div>' : '')
                : '<div class="st-vload">This photo could not be loaded.</div>';
        } else {
            body.style.background = item.bg || '#0f6b4f';
            body.innerHTML = '<div class="st-vtext">' + escapeHtml(item.text || '') + '</div>';
        }
        startTimer(n);
    }

    function next() {
        if (!viewer) return;
        if (viewer.i < viewer.group.items.length - 1) { viewer.i++; showItem(); }
        else closeViewer();
    }

    function prev() {
        if (!viewer) return;
        if (viewer.i > 0) viewer.i--;
        showItem();
    }

    async function onFootClick(e) {
        const act = e.target.closest('[data-act]');
        if (!act || !viewer) return;
        const item = viewer.group.items[viewer.i];

        if (act.dataset.act === 'like') { toggleLike(item); return; }
        if (act.dataset.act === 'comments') { openComments(item); return; }

        if (act.dataset.act === 'views') {
            clearTimeout(viewer.timer);
            const fill = $('st-fill');
            if (fill) fill.style.animationPlayState = 'paused';
            const panel = $('st-viewers');
            panel.innerHTML = '<div class="st-head"><strong>Viewed by</strong><button type="button" class="st-x" id="st-vw-close" aria-label="Close">&times;</button></div><div class="st-empty">Loading...</div>';
            panel.classList.add('open');
            $('st-vw-close').addEventListener('click', () => { panel.classList.remove('open'); showItem(); });
            const r = await api('GET', '/' + item.id + '/viewers');
            const list = (r.ok && r.data && r.data.viewers) || [];
            panel.querySelector('.st-empty').outerHTML = list.length
                ? list.map(v => '<div class="st-row" style="cursor:default">' + avatar(v.user_id, v.username, 36) + '<span><strong>' + escapeHtml(v.username) + '</strong><small>' + ago(v.viewed_at) + '</small></span></div>').join('')
                : '<div class="st-empty">No one has viewed this yet.</div>';
        } else if (act.dataset.act === 'delete') {
            clearTimeout(viewer.timer);
            if (!confirm('Delete this status?')) { showItem(); return; }
            const r = await api('DELETE', '/' + item.id);
            if (!r.ok) { notify('Could not delete the status'); showItem(); return; }
            const g = viewer.group;
            g.items.splice(viewer.i, 1);
            notify('Status deleted');
            if (!g.items.length) { feed = feed.filter(x => x !== g); closeViewer(); return; }
            if (viewer.i >= g.items.length) viewer.i = g.items.length - 1;
            showItem();
        }
    }

    function paintFoot() {
        if (!viewer) return;
        const g = viewer.group;
        const item = g.items[viewer.i];
        const likes = item.likes || 0;
        const comments = item.comments || 0;
        $('st-vfoot').innerHTML = g.is_me
            ? '<button type="button" class="st-btn" data-act="views">Views (' + (item.views || 0) + ')</button>'
              + '<button type="button" class="st-btn" data-act="comments">&#9829; ' + likes + ' &middot; Comments (' + comments + ')</button>'
              + '<button type="button" class="st-btn" data-act="delete">Delete</button>'
            : '<button type="button" class="st-btn' + (item.liked ? ' liked' : '') + '" data-act="like" aria-pressed="' + (item.liked ? 'true' : 'false') + '">'
              + (item.liked ? '&#9829;' : '&#9825;') + ' ' + likes + '</button>'
              + '<button type="button" class="st-btn" data-act="comments">Comments (' + comments + ')</button>';
    }

    async function toggleLike(item) {
        item.liked = !item.liked;
        item.likes = Math.max(0, (item.likes || 0) + (item.liked ? 1 : -1));
        paintFoot();
        const r = await api('POST', '/' + item.id + '/like');
        if (r.ok && r.data) {
            item.liked = !!r.data.liked;
            item.likes = r.data.likes;
        } else {
            item.liked = !item.liked;
            item.likes = Math.max(0, (item.likes || 0) + (item.liked ? 1 : -1));
            notify('Could not save your like');
        }
        paintFoot();
    }

    function pauseViewer() {
        if (!viewer) return;
        clearTimeout(viewer.timer);
        const fill = $('st-fill');
        if (fill) fill.style.animationPlayState = 'paused';
    }

    function commentRow(c) {
        return '<div class="st-row" data-cid="' + c.id + '" style="cursor:default;align-items:flex-start">' + avatar(c.user_id, c.username, 34)
            + '<span style="flex:1;min-width:0"><strong>' + escapeHtml(c.username) + '</strong> <small style="display:inline">' + ago(c.created_at) + '</small>'
            + '<span style="display:block;white-space:pre-wrap;word-break:break-word">' + escapeHtml(c.text) + '</span></span>'
            + (c.can_delete ? '<button type="button" class="st-x" data-del="' + c.id + '" aria-label="Delete comment">&times;</button>' : '')
            + '</div>';
    }

    async function openComments(item) {
        pauseViewer();
        const panel = $('st-viewers');
        panel.innerHTML = '<div class="st-head"><strong>Comments</strong><button type="button" class="st-x" id="st-cm-close" aria-label="Close">&times;</button></div>'
            + '<div id="st-likers" class="st-note" hidden></div>'
            + '<div id="st-clist"><div class="st-empty">Loading...</div></div>'
            + '<div class="st-cform"><input type="text" id="st-cinput" maxlength="300" placeholder="Add a comment" autocomplete="off">'
            + '<button type="button" class="st-btn" id="st-csend">Send</button></div>';
        panel.classList.add('open');

        $('st-cm-close').addEventListener('click', () => { panel.classList.remove('open'); if (viewer) showItem(); });
        const input = $('st-cinput');
        $('st-csend').addEventListener('click', () => sendComment(item));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendComment(item); } });
        $('st-clist').addEventListener('click', (e) => {
            const b = e.target.closest('[data-del]');
            if (b) removeComment(item, Number(b.dataset.del));
        });

        const r = await api('GET', '/' + item.id + '/engagement');
        if (!r.ok || !r.data) { $('st-clist').innerHTML = '<div class="st-empty">Could not load comments.</div>'; return; }
        item.likes = r.data.likes;
        item.liked = r.data.liked;
        item.comments = r.data.comments.length;
        paintFoot();
        if (r.data.likers && r.data.likers.length) {
            const l = $('st-likers');
            l.hidden = false;
            l.textContent = 'Liked by ' + r.data.likers.map(x => x.username).join(', ');
        }
        $('st-clist').innerHTML = r.data.comments.length
            ? r.data.comments.map(commentRow).join('')
            : '<div class="st-empty">No comments yet. Be the first.</div>';
        input.focus();
    }

    async function sendComment(item) {
        const input = $('st-cinput');
        const text = input.value.trim();
        if (!text) return;
        const btn = $('st-csend');
        btn.disabled = true;
        const r = await api('POST', '/' + item.id + '/comments', { text: text });
        btn.disabled = false;
        if (r.ok && r.data && r.data.comment) {
            input.value = '';
            item.comments = (item.comments || 0) + 1;
            const list = $('st-clist');
            const empty = list.querySelector('.st-empty');
            if (empty) empty.remove();
            list.insertAdjacentHTML('beforeend', commentRow(r.data.comment));
            $('st-viewers').scrollTop = $('st-viewers').scrollHeight;
            paintFoot();
        } else {
            const d = r.data && r.data.detail;
            notify(typeof d === 'string' ? d : 'Could not post your comment');
        }
    }

    async function removeComment(item, id) {
        if (!confirm('Delete this comment?')) return;
        const r = await api('DELETE', '/comments/' + id);
        if (!r.ok) { notify('Could not delete the comment'); return; }
        const row = document.querySelector('[data-cid="' + id + '"]');
        if (row) row.remove();
        item.comments = Math.max(0, (item.comments || 1) - 1);
        paintFoot();
        const list = $('st-clist');
        if (!list.children.length) list.innerHTML = '<div class="st-empty">No comments yet. Be the first.</div>';
    }

    function init() {
        if (!localStorage.getItem('token')) return;
        build();
        loadFeed();
        setInterval(function () { if (document.visibilityState === 'visible') loadFeed(); }, 30000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
