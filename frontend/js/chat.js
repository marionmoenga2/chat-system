/**
 * Chat Application Logic
 * Manages WebSocket connection, message rendering, and user interactions.
 */

let ws = null;
let currentUser = null;
let selectedUserId = null;
let users = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 8;

// Initialize chat
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
        window.location.href = 'index.html';
        return;
    }

    currentUser = JSON.parse(userStr);
    document.getElementById('current-user').textContent = currentUser.username;

    connectWebSocket(token);
    loadUsers();

    // Refresh user list every 10 seconds
    setInterval(loadUsers, 10000);
});

// Establish WebSocket connection
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

// Handle incoming WebSocket messages
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

// Load all users
async function loadUsers() {
    const data = await apiGet('/api/users/');
    if (!data) return;

    users = data.filter(u => u.id !== currentUser.id);
    renderUsersList();

    const onlineData = await apiGet('/api/users/online');
    if (onlineData) {
        onlineData.online_users.forEach(id => updateUserStatus(id, true));
    }
}

// Render users list in sidebar
function renderUsersList() {
    const container = document.getElementById('users-list');
    container.innerHTML = '';

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item' + (user.id === selectedUserId ? ' active' : '');
        div.dataset.userId = user.id;
        div.onclick = () => selectUser(user);

        const initial = user.username.charAt(0).toUpperCase();

        div.innerHTML = `
            <div class="user-avatar">${escapeHtml(initial)}</div>
            <div class="user-details">
                <div class="user-name">${escapeHtml(user.username)}</div>
                <div class="user-status" id="status-${user.id}">Offline</div>
            </div>
        `;

        container.appendChild(div);
    });
}

// Select a user to chat with
async function selectUser(user) {
    selectedUserId = user.id;

    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const item = document.querySelector(`[data-user-id="${user.id}"]`);
    if (item) item.classList.add('active');

    document.getElementById('chat-header').innerHTML = `
        <h3>${escapeHtml(user.username)}</h3>
        <span id="header-status" class="user-status">Offline</span>
    `;

    // Sync the header status with the sidebar status
    const sidebarStatus = document.getElementById(`status-${user.id}`);
    if (sidebarStatus && sidebarStatus.textContent === 'Online') {
        updateUserStatus(user.id, true);
    }

    document.getElementById('message-input-area').style.display = 'block';

    await loadChatHistory(user.id);
}

// Load chat history with selected user
async function loadChatHistory(userId) {
    const messages = await apiGet(`/api/messages/history/${userId}?limit=50`);
    if (!messages) return;

    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    messages.forEach(msg => {
        const isSent = msg.sender_id === currentUser.id;
        appendMessage(msg, isSent);
    });

    scrollToBottom();
}

// Append a message to the chat
function appendMessage(msg, isSent) {
    const container = document.getElementById('messages-container');

    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'}`;

    const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    div.innerHTML = `
        ${!isSent ? `<div class="message-sender">${escapeHtml(msg.sender_username || '')}</div>` : ''}
        <div class="message-content">${escapeHtml(msg.content)}</div>
        <div class="message-time">${time}</div>
    `;

    container.appendChild(div);
    scrollToBottom();
}

// Send a message
function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();

    if (!content || !selectedUserId || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: 'private',
        receiver_id: selectedUserId,
        content: content
    }));
    input.value = '';
}

// Handle Enter key
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Handle typing indicator (throttled so it doesn't fire on every keystroke)
let lastTypingSent = 0;
function handleTyping() {
    if (!selectedUserId || !ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;

    ws.send(JSON.stringify({
        type: 'typing',
        receiver_id: selectedUserId
    }));
}

// Show typing indicator
let typingIndicatorTimeout;
function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    indicator.textContent = `${username} is typing...`;

    clearTimeout(typingIndicatorTimeout);
    typingIndicatorTimeout = setTimeout(() => {
        indicator.textContent = '';
    }, 3000);
}

// Update user online status
function updateUserStatus(userId, isOnline) {
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

// Filter users in sidebar
function filterUsers() {
    const search = document.getElementById('user-search').value.toLowerCase();
    document.querySelectorAll('.user-item').forEach(el => {
        const name = el.querySelector('.user-name').textContent.toLowerCase();
        el.style.display = name.includes(search) ? 'flex' : 'none';
    });
}

// Show notification toast
function showNotification(message) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.classList.add('show');

    setTimeout(() => {
        notif.classList.remove('show');
    }, 3000);
}

// Scroll to bottom of messages
function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update unread count badge
function updateUnreadCount(userId) {
    // Not implemented yet
}