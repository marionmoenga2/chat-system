/**
 * Admin Panel JavaScript
 * Handles admin authentication, user management, and message monitoring.
 */

// API_URL comes from js/config.js (the same file the login page uses), so it must load first.
const API_BASE = (typeof API_URL !== 'undefined') ? API_URL : 'http://localhost:8000';

let adminToken = localStorage.getItem('admin_token');

// Check auth on load
if (!adminToken && !window.location.pathname.includes('index')) {
    window.location.href = 'index.html?logout=1';
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
    };
}

// Escape text before putting it into the page, so a message or username
// containing HTML cannot run code in the admin's browser.
function esc(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// Shared request helper: sends the token, logs out on 401/403, throws on other errors.
async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: getHeaders()
    });

    if (response.status === 401 || response.status === 403) {
        alert('Your admin session has expired or you are not an admin. Please log in again.');
        logout();
        throw new Error(`Not authorised (HTTP ${response.status})`);
    }
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).detail || ''; } catch (e) { /* no JSON body */ }
        throw new Error(`HTTP ${response.status} ${detail}`.trim());
    }
    return response.json();
}

// Navigation
function showSection(sectionName) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${sectionName}-section`).classList.remove('hidden');

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if (window.event && window.event.target && window.event.target.classList) {
        window.event.target.classList.add('active');
    }

    if (sectionName === 'dashboard') loadStats();
    if (sectionName === 'users') loadUsers();
    if (sectionName === 'messages') loadMessages();
}

// Load Dashboard Stats
async function loadStats() {
    try {
        const data = await apiRequest('/api/admin/stats');

        document.getElementById('stat-users').textContent = data.total_users;
        document.getElementById('stat-messages').textContent = data.total_messages;
        document.getElementById('stat-active').textContent = data.active_users;
        document.getElementById('stat-online').textContent = data.online_now;
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

// Load Users
async function loadUsers() {
    try {
        const users = await apiRequest('/api/admin/users');

        const tbody = document.querySelector('#users-table tbody');
        tbody.innerHTML = '';

        users.forEach(user => {
            const id = Number(user.id);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${id}</td>
                <td>${esc(user.username)}</td>
                <td>${esc(user.email)}</td>
                <td><span class="badge ${user.is_active ? 'badge-active' : 'badge-banned'}">
                    ${user.is_active ? 'Active' : 'Banned'}
                </span></td>
                <td>${esc(new Date(user.created_at).toLocaleDateString())}</td>
                <td class="actions">
                    ${user.is_active
                        ? `<button onclick="banUser(${id})" class="btn btn-danger">Ban</button>`
                        : `<button onclick="unbanUser(${id})" class="btn btn-success">Unban</button>`
                    }
                    <button onclick="deleteUser(${id})" class="btn btn-danger">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to load users:', e);
    }
}

// Ban User
async function banUser(userId) {
    if (!confirm('Ban this user?')) return;
    try {
        await apiRequest(`/api/admin/users/${userId}/ban`, { method: 'POST' });
    } catch (e) {
        alert('Could not ban the user: ' + e.message);
    }
    loadUsers();
}

// Unban User
async function unbanUser(userId) {
    try {
        await apiRequest(`/api/admin/users/${userId}/unban`, { method: 'POST' });
    } catch (e) {
        alert('Could not unban the user: ' + e.message);
    }
    loadUsers();
}

// Delete User
async function deleteUser(userId) {
    if (!confirm('Permanently delete this user?')) return;
    try {
        await apiRequest(`/api/admin/users/${userId}`, { method: 'DELETE' });
    } catch (e) {
        alert('Could not delete the user: ' + e.message);
    }
    loadUsers();
}

// Load Messages
async function loadMessages() {
    const search = document.getElementById('msg-search').value;
    const userId = document.getElementById('msg-user-id').value;

    let path = '/api/admin/messages?limit=100';
    if (search) path += `&search=${encodeURIComponent(search)}`;
    if (userId) path += `&user_id=${encodeURIComponent(userId)}`;

    try {
        const messages = await apiRequest(path);

        const tbody = document.querySelector('#messages-table tbody');
        tbody.innerHTML = '';

        messages.forEach(msg => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${Number(msg.id)}</td>
                <td>${Number(msg.sender_id)}</td>
                <td>${Number(msg.receiver_id)}</td>
                <td>${esc(msg.content)}</td>
                <td>${esc(new Date(msg.timestamp + (/[zZ]$|[+-]\d\d:?\d\d$/.test(msg.timestamp) ? '' : 'Z')).toLocaleString())}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
}

// Logout
function logout() {
    ['token', 'user', 'admin_token', 'admin_user'].forEach(k => localStorage.removeItem(k));
    window.location.href = 'index.html?logout=1';
}

// Load initial data if on dashboard
if (document.getElementById('dashboard-section')) {
    loadStats();
}