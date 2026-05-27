/**
 * Chat Application Logic
 * Manages WebSocket connection, message rendering, and user interactions.
 */

let ws = null;
let currentUser = null;
let selectedUserId = null;
let users = [];
let typingTimeout = null;

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
    
    // Connect WebSocket
    connectWebSocket(token);
    
    // Load users
    loadUsers();
    
    // Poll for online users every 10 seconds
    setInterval(loadUsers, 10000);
});

// Establish WebSocket connection
function connectWebSocket(token) {
    ws = new WebSocket(`ws://localhost:8000/ws/${token}`);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected, retrying...');
        setTimeout(() => connectWebSocket(localStorage.getItem('token')), 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'message':
            // If message is from/to selected user, display it
            if (selectedUserId && 
                (data.sender_id === selectedUserId || data.receiver_id === selectedUserId)) {
                appendMessage(data, data.sender_id === currentUser.id);
            }
            // If message is from someone else, show notification
            else if (data.sender_id !== currentUser.id) {
                showNotification(`New message from ${data.sender_username}`);
                updateUnreadCount(data.sender_id);
            }
            break;
            
        case 'user_status':
            // Update user online status
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
    
    // Also get online users
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
        div.className = 'user-item';
        div.dataset.userId = user.id;
        div.onclick = () => selectUser(user);
        
        const initial = user.username.charAt(0).toUpperCase();
        
        div.innerHTML = `
            <div class="user-avatar">${initial}</div>
            <div class="user-details">
                <div class="user-name">${user.username}</div>
                <div class="user-status" id="status-${user.id}">Offline</div>
            </div>
        `;
        
        container.appendChild(div);
    });
}

// Select a user to chat with
async function selectUser(user) {
    selectedUserId = user.id;
    
    // Update UI
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-user-id="${user.id}"]`).classList.add('active');
    
    document.getElementById('chat-header').innerHTML = `
        <h3>${user.username}</h3>
        <span id="header-status" class="user-status">Offline</span>
    `;
    
    document.getElementById('message-input-area').style.display = 'block';
    
    // Load chat history
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
        ${!isSent ? `<div class="message-sender">${msg.sender_username}</div>` : ''}
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
    
    if (!content || !selectedUserId || !ws) return;
    
    const message = {
        type: 'private',
        receiver_id: selectedUserId,
        content: content
    };
    
    ws.send(JSON.stringify(message));
    input.value = '';
}

// Handle Enter key
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Handle typing indicator
function handleTyping() {
    if (!selectedUserId || !ws) return;
    
    clearTimeout(typingTimeout);
    
    ws.send(JSON.stringify({
        type: 'typing',
        receiver_id: selectedUserId
    }));
    
    typingTimeout = setTimeout(() => {
        // Stop typing indicator after 2 seconds
    }, 2000);
}

// Show typing indicator
function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    indicator.textContent = `${username} is typing...`;
    
    setTimeout(() => {
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
    
    // Update header if this is the selected user
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
    // Implementation for unread badges would go here
    // This would require additional API calls or state management
}