/**
 * Chat Application Logic
 * WebSocket connection, messages, replies and profile photos.
 * API_URL / WS_URL come from config.js; apiGet/apiPost/apiDelete/logout come from api.js.
 */

let ws = null;
let currentUser = null;
let selectedUserId = null;
let users = [];
let onlineSet = new Set();
let avatarVersions = {};   // { "userId": versionToken } for users who have a photo
let replyingTo = null;     // { id, sender_username, content }
let pendingAvatar = null;  // new photo chosen in the profile dialog, not saved yet
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 8;

const AVATAR_COLORS = [
    ['#3b82f6', '#8b5cf6'], ['#06b6d4', '#3b82f6'], ['#ec4899', '#f97316'],
    ['#10b981', '#06b6d4'], ['#f59e0b', '#ef4444'], ['#8b5cf6', '#ec4899'],
    ['#14b8a6', '#84cc16'], ['#6366f1', '#06b6d4']
];

// ---------- Small helpers ----------

function avatarGradient(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const c = AVATAR_COLORS[h % AVATAR_COLORS.length];
    return `linear-gradient(135deg, ${c[0]}, ${c[1]})`;
}

// Server timestamps are UTC; treat them as UTC even when the "Z" is missing
function parseTime(ts) {
    if (!ts) return new Date();
    const hasZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(ts);
    return new Date(hasZone ? ts : ts + 'Z');
}

function formatTime(ts) {
    return parseTime(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// Initial letter, with the photo (if any) laid over it. If the photo fails, the letter shows.
function avatarHtml(userId, username) {
    const initial = escapeHtml((username || '?').charAt(0).toUpperCase());
    const version = avatarVersions[String(userId)];
    const img = version
        ? `<img src="${API_URL}/api/profile/avatar/${userId}?v=${version}" alt="" onerror="this.remove()">`
        : '';
    return `<span class="avatar-initial">${initial}</span>${img}`;
}

// ---------- Startup ----------

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
        window.location.href = 'index.html';
        return;
    }

    try {
        currentUser = JSON.parse(userStr);
    } catch (e) {
        logout();
        return;
    }

    document.getElementById('current-user').textContent = currentUser.username;
    renderMyAvatar();

    connectWebSocket(token);
    loadUsers();
    setInterval(loadUsers, 10000);

    setupMessageInteractions();
});

// ---------- WebSocket ----------

function connectWebSocket(token) {
    ws = new WebSocket(`${WS_URL}/ws/${token}`);

    ws.onopen = () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = () => {
        const currentToken = localStorage.getItem('token');
        if (!currentToken) return; // logged out

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            showNotification('Connection lost. Please refresh the page.');
            return;
        }

        // Backoff: 3s, 6s, 9s ... (the free Render plan can take ~60s to wake up)
        reconnectAttempts++;
        console.log(`WebSocket disconnected, retry ${reconnectAttempts}...`);
        setTimeout(() => connectWebSocket(currentToken), 3000 * reconnectAttempts);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'message':
            // Message belongs to the open conversation
            if (selectedUserId &&
                (data.sender_id === selectedUserId || data.receiver_id === selectedUserId)) {
                appendMessage(data, data.sender_id === currentUser.id);
            }
            // Message from someone else
            else if (data.sender_id !== currentUser.id) {
                showNotification(`New message from ${data.sender_username}`);
                updateUnreadCount(data.sender_id);
            }
            break;

        case 'user_status':
            updateUserStatus(data.user_id, data.status === 'online');
            break;

        case 'typing':
            if (data.user_id === selectedUserId) {
                showTypingIndicator(data.username);
            }
            break;
    }
}

// ---------- Users list ----------

async function loadUsers() {
    const [data, onlineData, avatarData] = await Promise.all([
        apiGet('/api/users/'),
        apiGet('/api/users/online'),
        apiGet('/api/profile/avatars')
    ]);
    if (!data) return;

    users = data.filter(u => u.id !== currentUser.id);
    if (onlineData && onlineData.online_users) onlineSet = new Set(onlineData.online_users);
    if (avatarData && avatarData.avatars) avatarVersions = avatarData.avatars;

    renderUsersList();
    renderMyAvatar();
}

function renderUsersList() {
    const container = document.getElementById('users-list');
    container.innerHTML = '';

    users.forEach(user => {
        const online = onlineSet.has(user.id);

        const div = document.createElement('div');
        div.className = 'user-item'
            + (user.id === selectedUserId ? ' active' : '')
            + (online ? ' is-online' : '');
        div.dataset.userId = user.id;
        div.onclick = () => selectUser(user);

        div.innerHTML = `
            <div class="user-avatar" style="background:${avatarGradient(user.username)}">
                ${avatarHtml(user.id, user.username)}
            </div>
            <div class="user-details">
                <div class="user-name">${escapeHtml(user.username)}</div>
                <div class="user-status ${online ? 'online' : ''}" id="status-${user.id}">${online ? 'Online' : 'Offline'}</div>
            </div>
        `;

        container.appendChild(div);
    });

    filterUsers(); // keep the search filter applied after every refresh
}

function filterUsers() {
    const search = document.getElementById('user-search').value.trim().toLowerCase();
    const container = document.getElementById('users-list');
    let visible = 0;

    container.querySelectorAll('.user-item').forEach(el => {
        const name = el.querySelector('.user-name').textContent.toLowerCase();
        const match = name.includes(search);
        el.style.display = match ? 'flex' : 'none';
        if (match) visible++;
    });

    let empty = document.getElementById('no-users-msg');
    if (!empty) {
        empty = document.createElement('div');
        empty.id = 'no-users-msg';
        empty.className = 'empty-state';
        container.appendChild(empty);
    }
    empty.textContent = visible === 0
        ? (users.length === 0 ? 'No other users yet' : 'No users match your search')
        : '';
    empty.style.display = visible === 0 ? 'block' : 'none';
}

function updateUserStatus(userId, isOnline) {
    userId = Number(userId);
    if (isOnline) onlineSet.add(userId); else onlineSet.delete(userId);

    const item = document.querySelector(`.user-item[data-user-id="${userId}"]`);
    if (item) item.classList.toggle('is-online', isOnline);

    const statusEl = document.getElementById(`status-${userId}`);
    if (statusEl) {
        statusEl.textContent = isOnline ? 'Online' : 'Offline';
        statusEl.className = `user-status ${isOnline ? 'online' : ''}`;
    }

    if (selectedUserId === userId) {
        const headerStatus = document.getElementById('header-status');
        if (headerStatus) {
            headerStatus.textContent = isOnline ? 'Online' : 'Offline';
            headerStatus.className = `user-status ${isOnline ? 'online' : ''}`;
        }
    }
}

function renderMyAvatar() {
    const el = document.getElementById('my-avatar');
    if (!el || !currentUser) return;
    el.style.background = avatarGradient(currentUser.username);
    el.innerHTML = avatarHtml(currentUser.id, currentUser.username);
}

// ---------- Conversations ----------

async function selectUser(user) {
    selectedUserId = user.id;
    cancelReply();

    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const item = document.querySelector(`.user-item[data-user-id="${user.id}"]`);
    if (item) item.classList.add('active');

    const online = onlineSet.has(user.id);
    document.getElementById('chat-header').innerHTML = `
        <div class="header-avatar" style="background:${avatarGradient(user.username)}">
            ${avatarHtml(user.id, user.username)}
        </div>
        <div class="chat-header-info">
            <h3>${escapeHtml(user.username)}</h3>
            <span id="header-status" class="user-status ${online ? 'online' : ''}">${online ? 'Online' : 'Offline'}</span>
        </div>
    `;

    document.getElementById('message-input-area').style.display = 'block';

    // On mobile: hide the list, show the conversation
    document.getElementById('chat-app').classList.add('chat-open');
    document.getElementById('mobile-chat-title').textContent = user.username;

    await loadChatHistory(user.id);
}

// Go back to the user list (mobile)
function showSidebar() {
    document.getElementById('chat-app').classList.remove('chat-open');
}

async function loadChatHistory(userId) {
    let messages = await apiGet(`/api/chat/history/${userId}?limit=100`);
    if (!messages) messages = await apiGet(`/api/messages/history/${userId}?limit=50`); // fallback
    if (!messages) return;

    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    messages.forEach(msg => {
        appendMessage(msg, msg.sender_id === currentUser.id);
    });

    scrollToBottom();
}

function appendMessage(msg, isSent) {
    const container = document.getElementById('messages-container');

    // Ignore duplicates (for example the same message arriving twice)
    if (msg.id && container.querySelector(`[data-msg-id="${msg.id}"]`)) return;

    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    if (msg.id) div.dataset.msgId = msg.id;
    div.dataset.sender = isSent ? 'You' : (msg.sender_username || '');
    div.dataset.content = msg.content || '';

    let quote = '';
    if (msg.reply_to) {
        const quotedName = msg.reply_to.sender_id === currentUser.id
            ? 'You'
            : (msg.reply_to.sender_username || '');
        quote = `
            <div class="reply-quote" data-reply-id="${Number(msg.reply_to.id)}">
                <span class="reply-quote-name">${escapeHtml(quotedName)}</span>
                <span class="reply-quote-text">${escapeHtml(msg.reply_to.content)}</span>
            </div>`;
    }

    div.innerHTML = `
        ${quote}
        <div class="message-content">${escapeHtml(msg.content)}</div>
        <div class="message-meta">
            <span class="message-time">${formatTime(msg.timestamp)}</span>
            <button type="button" class="reply-btn" title="Reply" aria-label="Reply to this message">&#8617;</button>
        </div>
    `;

    container.appendChild(div);
    scrollToBottom();
}

// ---------- Replies ----------

function startReply(msgEl) {
    if (!msgEl || !msgEl.dataset.msgId) return;

    replyingTo = {
        id: Number(msgEl.dataset.msgId),
        sender_username: msgEl.dataset.sender,
        content: msgEl.dataset.content
    };

    const who = replyingTo.sender_username === 'You' ? 'yourself' : replyingTo.sender_username;
    document.getElementById('reply-bar-name').textContent = `Replying to ${who}`;
    document.getElementById('reply-bar-text').textContent = replyingTo.content;
    document.getElementById('reply-bar').classList.add('show');
    document.getElementById('message-input').focus();
}

function cancelReply() {
    replyingTo = null;
    const bar = document.getElementById('reply-bar');
    if (bar) bar.classList.remove('show');
}

function scrollToMessage(id) {
    const container = document.getElementById('messages-container');
    const target = container.querySelector(`[data-msg-id="${id}"]`);
    if (!target) {
        showNotification('That message is further up in the history');
        return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1600);
}

function setupMessageInteractions() {
    const container = document.getElementById('messages-container');

    container.addEventListener('click', (e) => {
        const replyBtn = e.target.closest('.reply-btn');
        if (replyBtn) {
            startReply(replyBtn.closest('.message'));
            return;
        }
        const quote = e.target.closest('.reply-quote');
        if (quote) scrollToMessage(quote.dataset.replyId);
    });

    // Swipe right on a message to reply (touch screens)
    let startX = 0, startY = 0, swipeTarget = null;

    container.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        swipeTarget = e.target.closest('.message');
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (!swipeTarget) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = Math.abs(t.clientY - startY);
        if (dx > 70 && dy < 35) startReply(swipeTarget);
        swipeTarget = null;
    }, { passive: true });
}

// ---------- Sending ----------

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content) return;
    if (!selectedUserId) {
        showNotification('Select a user first');
        return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('Not connected yet. The server may be waking up, try again in a moment.');
        return;
    }

    const payload = { type: 'private', receiver_id: selectedUserId, content: content };
    if (replyingTo) payload.reply_to_id = replyingTo.id;

    ws.send(JSON.stringify(payload));
    input.value = '';
    cancelReply();
    input.focus();
}

function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        sendMessage();
    } else if (event.key === 'Escape') {
        cancelReply();
    }
}

// Typing indicator (throttled so it doesn't fire on every keystroke)
let lastTypingSent = 0;
function handleTyping() {
    if (!selectedUserId || !ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;

    ws.send(JSON.stringify({ type: 'typing', receiver_id: selectedUserId }));
}

let typingIndicatorTimeout;
function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    indicator.textContent = `${username} is typing...`;

    clearTimeout(typingIndicatorTimeout);
    typingIndicatorTimeout = setTimeout(() => {
        indicator.textContent = '';
    }, 3000);
}

// ---------- Profile photo ----------

function openProfile() {
    pendingAvatar = null;
    document.getElementById('profile-name').textContent = currentUser.username;
    renderProfilePreview();
    document.getElementById('profile-modal').classList.add('open');
}

function closeProfile() {
    document.getElementById('profile-modal').classList.remove('open');
    document.getElementById('photo-input').value = '';
    pendingAvatar = null;
}

function renderProfilePreview() {
    const preview = document.getElementById('profile-preview');
    preview.style.background = avatarGradient(currentUser.username);

    if (pendingAvatar) {
        preview.innerHTML = `<img src="${pendingAvatar}" alt="">`;
    } else {
        preview.innerHTML = avatarHtml(currentUser.id, currentUser.username);
    }
}

// Crop to a centered square and shrink, so the upload stays small
function resizeImage(file, size = 256) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('That file is not a valid image'));
            img.onload = () => {
                const side = Math.min(img.width, img.height);
                const sx = (img.width - side) / 2;
                const sy = (img.height - side) / 2;

                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, size, size);
                ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handlePhotoSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showNotification('Please choose an image file');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showNotification('That image is too large (max 10 MB)');
        return;
    }

    try {
        pendingAvatar = await resizeImage(file);
        renderProfilePreview();
    } catch (err) {
        console.error(err);
        showNotification(err.message);
    }
}

async function saveProfilePhoto() {
    if (!pendingAvatar) {
        closeProfile();
        return;
    }

    const btn = document.getElementById('save-photo-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const res = await apiPost('/api/profile/avatar', { image: pendingAvatar });

    btn.disabled = false;
    btn.textContent = 'Save';

    if (res && res.ok) {
        avatarVersions[String(currentUser.id)] = Date.now();
        renderMyAvatar();
        closeProfile();
        showNotification('Profile photo updated');
    } else {
        showNotification('Could not save the photo. Try a smaller image.');
    }
}

async function removeProfilePhoto() {
    const res = await apiDelete('/api/profile/avatar');
    if (res) {
        delete avatarVersions[String(currentUser.id)];
        pendingAvatar = null;
        renderMyAvatar();
        renderProfilePreview();
        showNotification('Profile photo removed');
    } else {
        showNotification('Could not remove the photo');
    }
}

// ---------- Misc ----------

function showNotification(message) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.classList.add('show');

    clearTimeout(showNotification._t);
    showNotification._t = setTimeout(() => {
        notif.classList.remove('show');
    }, 3000);
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

function updateUnreadCount(userId) {
    // Not implemented yet
}