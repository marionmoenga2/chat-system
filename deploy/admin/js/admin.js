/**
 * Admin Panel JavaScript
 * Handles admin authentication, user management, and message monitoring.
 */

const API_BASE = 'http://localhost:8000';
let adminToken = localStorage.getItem('admin_token');

// Check auth on load
if (!adminToken && !window.location.pathname.includes('index')) {
    window.location.href = 'index.html';
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
    };
}

// Navigation
function showSection(sectionName) {
    document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${sectionName}-section`).classList.remove('hidden');
    
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    event.target.classList.add('active');
    
    if (sectionName === 'dashboard') loadStats();
    if (sectionName === 'users') loadUsers();
    if (sectionName === 'messages') loadMessages();
}

// Load Dashboard Stats
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/stats`, {
            headers: getHeaders()
        });
        const data = await response.json();
        
        document.getElementById('stat-users').textContent = data.total_users;
        document.getElementById('stat-messages').textContent = data.total_messages;
        document.getElementById('stat-active').textContent = data.active_users;
        document.getElementById('stat-online').textContent = data.online_now;
    } catch (e) {
        console.error('Failed to load stats');
    }
}

// Load Users
async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/users`, {
            headers: getHeaders()
        });
        const users = await response.json();
        
        const tbody = document.querySelector('#users-table tbody');
        tbody.innerHTML = '';
        
        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td><span class="badge ${user.is_active ? 'badge-active' : 'badge-banned'}">
                    ${user.is_active ? 'Active' : 'Banned'}
                </span></td>
                <td>${new Date(user.created_at).toLocaleDateString()}</td>
                <td class="actions">
                    ${user.is_active 
                        ? `<button onclick="banUser(${user.id})" class="btn btn-danger">Ban</button>`
                        : `<button onclick="unbanUser(${user.id})" class="btn btn-success">Unban</button>`
                    }
                    <button onclick="deleteUser(${user.id})" class="btn btn-danger">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to load users');
    }
}

// Ban User
async function banUser(userId) {
    if (!confirm('Ban this user?')) return;
    await fetch(`${API_BASE}/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: getHeaders()
    });
    loadUsers();
}

// Unban User
async function unbanUser(userId) {
    await fetch(`${API_BASE}/api/admin/users/${userId}/unban`, {
        method: 'POST',
        headers: getHeaders()
    });
    loadUsers();
}

// Delete User
async function deleteUser(userId) {
    if (!confirm('Permanently delete this user?')) return;
    await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
    loadUsers();
}

// Load Messages
async function loadMessages() {
    const search = document.getElementById('msg-search').value;
    const userId = document.getElementById('msg-user-id').value;
    
    let url = `${API_BASE}/api/admin/messages?limit=100`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (userId) url += `&user_id=${userId}`;
    
    try {
        const response = await fetch(url, { headers: getHeaders() });
        const messages = await response.json();
        
        const tbody = document.querySelector('#messages-table tbody');
        tbody.innerHTML = '';
        
        messages.forEach(msg => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${msg.id}</td>
                <td>${msg.sender_id}</td>
                <td>${msg.receiver_id}</td>
                <td>${msg.content}</td>
                <td>${new Date(msg.timestamp).toLocaleString()}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to load messages');
    }
}

// Logout
function logout() {
    localStorage.removeItem('admin_token');
    window.location.href = 'index.html';
}

// Load initial data if on dashboard
if (document.getElementById('dashboard-section')) {
    loadStats();
}