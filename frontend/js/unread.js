/**
 * Unread message badges, so people who were offline can see who wrote to them.
 * Loads after chat.js. Needs API_URL (config.js) and the chat.js globals.
 */
(function () {
    'use strict';

    let unread = {};   // { "userId": number of unread messages }
    const BASE_TITLE = document.title;

    const style = document.createElement('style');
    style.textContent = `
        .unread-badge { margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
            background: #1f4fd8; color: #fff; font-size: .75rem; font-weight: 700; display: inline-flex;
            align-items: center; justify-content: center; flex-shrink: 0; }
        .user-item.has-unread .user-name { font-weight: 700; }
    `;
    document.head.appendChild(style);

    async function api(method, path) {
        const token = localStorage.getItem('token');
        if (!token || typeof API_URL === 'undefined') return null;
        try {
            const res = await fetch(API_URL + path, { method: method, headers: { 'Authorization': 'Bearer ' + token } });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    function markRead(userId) {
        return api('POST', '/api/unread/' + userId + '/read');
    }

    function total() {
        return Object.values(unread).reduce(function (a, b) { return a + b; }, 0);
    }

    function paint() {
        document.querySelectorAll('.user-item').forEach(function (item) {
            const n = unread[item.dataset.userId] || 0;
            let badge = item.querySelector('.unread-badge');
            item.classList.toggle('has-unread', n > 0);
            if (n > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'unread-badge';
                    item.appendChild(badge);
                }
                badge.textContent = n > 99 ? '99+' : String(n);
            } else if (badge) {
                badge.remove();
            }
        });
        const t = total();
        document.title = t > 0 ? '(' + t + ') ' + BASE_TITLE : BASE_TITLE;
    }

    async function refresh(announce) {
        const data = await api('GET', '/api/unread');
        if (!data || !data.counts) return;

        // The conversation open right now is being read, so it is not "unread"
        const open = (typeof selectedUserId !== 'undefined') ? selectedUserId : null;
        if (open && data.counts[String(open)]) {
            markRead(open);
            delete data.counts[String(open)];
        }
        unread = data.counts;
        paint();

        if (announce && total() > 0 && typeof showNotification === 'function') {
            showNotification('You have ' + total() + ' unread message' + (total() === 1 ? '' : 's'));
        }
    }

    // Keep the badges when chat.js redraws the user list (it does this every 10 seconds)
    const originalRender = window.renderUsersList;
    if (typeof originalRender === 'function') {
        window.renderUsersList = function () {
            const result = originalRender.apply(this, arguments);
            paint();
            return result;
        };
    }

    // chat.js calls this when a message arrives from someone whose chat is not open
    window.updateUnreadCount = function (userId) {
        const key = String(userId);
        unread[key] = (unread[key] || 0) + 1;
        paint();
    };

    // A message arriving in the chat you are looking at counts as read straight away
    const originalWs = window.handleWebSocketMessage;
    if (typeof originalWs === 'function') {
        window.handleWebSocketMessage = function (data) {
            if (data && data.type === 'message' && typeof currentUser !== 'undefined' && currentUser &&
                typeof selectedUserId !== 'undefined' && selectedUserId &&
                data.sender_id !== currentUser.id && data.sender_id === selectedUserId) {
                markRead(data.sender_id);
            }
            return originalWs.apply(this, arguments);
        };
    }

    // Opening a conversation clears its badge
    const originalSelect = window.selectUser;
    if (typeof originalSelect === 'function') {
        window.selectUser = function (user) {
            const result = originalSelect.apply(this, arguments);
            delete unread[String(user.id)];
            paint();
            markRead(user.id);
            return result;
        };
    }

    if (localStorage.getItem('token')) {
        refresh(true);
        setInterval(function () { refresh(false); }, 20000);
    }
})();
