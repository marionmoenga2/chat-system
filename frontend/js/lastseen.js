/**
 * Shows "Last seen ..." for people who are offline, and adds a privacy switch to your own
 * profile card. Loads after chat.js, phone.js and email.js.
 */
(function () {
    'use strict';

    let lastSeen = {};   // { "userId": ISO time }
    let enabled = true;  // false when I have hidden mine (then I cannot see others' either)
    let mine;            // my own "show last seen" setting; undefined until loaded

    async function call(method, path, body) {
        const token = localStorage.getItem('token');
        if (!token || typeof API_URL === 'undefined') return null;
        try {
            const res = await fetch(API_URL + path, {
                method: method,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: body ? JSON.stringify(body) : undefined
            });
            return res.ok ? await res.json() : null;
        } catch (e) {
            return null;
        }
    }

    function label(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return 'Offline';
        const now = new Date();
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startThen = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const days = Math.round((startToday - startThen) / 86400000);
        if (days <= 0) return 'Last seen today at ' + time;
        if (days === 1) return 'Last seen yesterday at ' + time;
        if (days < 7) return 'Last seen ' + d.toLocaleDateString([], { weekday: 'long' }) + ' at ' + time;
        return 'Last seen ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    }

    function setText(el, userId) {
        if (!el || el.classList.contains('online')) return;
        const iso = enabled ? lastSeen[String(userId)] : null;
        const text = iso ? label(iso) : 'Offline';
        if (el.textContent !== text) el.textContent = text;
    }

    function paint() {
        document.querySelectorAll('.user-status[id^="status-"]').forEach(function (el) {
            const id = el.id.slice(7);
            if (/^\d+$/.test(id)) setText(el, id);
        });
        if (typeof selectedUserId !== 'undefined' && selectedUserId) {
            setText(document.getElementById('header-status'), selectedUserId);
        }
    }

    async function load() {
        const d = await call('GET', '/api/users/last-seen');
        if (!d) return;
        enabled = d.enabled !== false;
        lastSeen = d.last_seen || {};
        paint();
    }

    // Run our code after one of chat.js's own functions
    function wrap(name, after) {
        const original = window[name];
        if (typeof original !== 'function') return;
        window[name] = function () {
            const result = original.apply(this, arguments);
            after.apply(null, arguments);
            return result;
        };
    }

    let reloadTimer = null;
    wrap('renderUsersList', paint);
    wrap('selectUser', paint);
    wrap('updateUserStatus', function (userId, isOnline) {
        paint();
        if (!isOnline) {
            // the server saves the time when they disconnect; fetch it a moment later
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(load, 1500);
        }
    });

    // ---------- Privacy switch on my own profile card ----------

    function paintRow(row) {
        row.innerHTML = `
            <div>
                <div class="phone-label">Last seen</div>
                <div class="phone-value">Show my last seen</div>
                <div class="phone-label" style="font-weight:400;margin-top:2px">If you hide yours, you will not see other people's either.</div>
            </div>
            <input type="checkbox" id="lastseen-toggle" aria-label="Show my last seen"
                   style="width:20px;height:20px;flex-shrink:0;accent-color:#1f4fd8;cursor:pointer">
        `;
        const box = row.querySelector('input');
        box.checked = mine !== false;
        box.addEventListener('change', async function () {
            const want = box.checked;
            const r = await call('PUT', '/api/users/last-seen/setting', { show: want });
            if (r) {
                mine = want;
                if (typeof showNotification === 'function') {
                    showNotification(want ? 'Your last seen is visible' : 'Your last seen is hidden');
                }
                load();
            } else {
                box.checked = !want;
            }
        });
    }

    function placeRow(isSelf) {
        const existing = document.getElementById('lastseen-row');
        if (existing) existing.remove();
        const card = document.getElementById('profile-card');
        if (!isSelf || !card) return;
        const row = document.createElement('div');
        row.className = 'phone-row';
        row.id = 'lastseen-row';
        paintRow(row);
        card.appendChild(row);
    }

    wrap('showProfile', function (userId) {
        placeRow(typeof currentUser !== 'undefined' && !!currentUser && Number(userId) === currentUser.id);
    });

    async function init() {
        if (!localStorage.getItem('token')) return;
        const s = await call('GET', '/api/users/last-seen/setting');
        if (s) mine = !!s.show;
        load();
        setInterval(load, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
