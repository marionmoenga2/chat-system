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
    if (sectionName === 'ai') { loadAiKey(); loadGeminiKey(); loadGroqKey(); }
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
                <td>${esc(user.phone || '–')}</td>
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


// ---------- AI assistant key ----------

function setAiMsg(text, ok) {
    const el = document.getElementById('ai-msg');
    el.textContent = text;
    el.className = 'ai-msg ' + (ok ? 'ok' : 'err');
}

async function loadAiKey() {
    const box = document.getElementById('ai-status');
    try {
        const s = await apiRequest('/api/admin/ai-key');
        if (s.configured) {
            const from = s.source === 'render' ? 'set in Render' : 'saved from this panel';
            box.innerHTML = '<span class="ai-dot on"></span>Assistant is on (key ending in ' + esc(s.last4) + ', ' + from + ')';
        } else {
            box.innerHTML = '<span class="ai-dot"></span>Assistant is off. Paste a key below to turn it on.';
        }
        document.getElementById('ai-remove').style.display = s.has_saved ? '' : 'none';
    } catch (e) {
        box.textContent = 'Could not load the AI settings.';
    }
}

async function saveAiKey() {
    const input = document.getElementById('ai-key-input');
    const key = input.value.trim();
    if (!key) { setAiMsg('Paste your API key first.', false); return; }

    setAiMsg('Saving and testing...', true);
    try {
        const r = await apiRequest('/api/admin/ai-key', { method: 'PUT', body: JSON.stringify({ api_key: key }) });
        input.value = '';
        await loadAiKey();
        if (r.test === 'ok') setAiMsg('Saved. The key works, so the assistant is on.', true);
        else if (r.test === 'rejected') setAiMsg('Saved, but Anthropic rejected this key. Check that it is correct and active.', false);
        else if (r.test === 'rate_limited') setAiMsg('Saved. Anthropic is limiting requests right now, so try the assistant again shortly.', true);
        else if (r.test === 'unreachable') setAiMsg('Saved, but the server could not reach Anthropic to test it.', false);
        else setAiMsg('Saved, but the test returned an error (' + String(r.test).replace('error_', '') + '). Check your Anthropic billing and credits.', false);
    } catch (e) {
        setAiMsg((e.message || '').replace(/^HTTP \d+\s*/, '') || 'Could not save the key.', false);
    }
}

async function removeAiKey() {
    if (!confirm('Remove the saved key? The assistant will turn off unless a key is set in Render.')) return;
    try {
        await apiRequest('/api/admin/ai-key', { method: 'DELETE' });
        await loadAiKey();
        setAiMsg('Saved key removed.', true);
    } catch (e) {
        setAiMsg('Could not remove the key.', false);
    }
}


// ---------- Gemini key ----------

function setGemMsg(text, ok) {
    const el = document.getElementById('gem-msg');
    el.textContent = text;
    el.className = 'ai-msg ' + (ok ? 'ok' : 'err');
}

async function loadGeminiKey() {
    const box = document.getElementById('gem-status');
    try {
        const s = await apiRequest('/api/admin/gemini-key');
        if (s.configured) {
            const from = s.source === 'render' ? 'set in Render' : 'saved from this panel';
            box.innerHTML = '<span class="ai-dot on"></span>Gemini is on (key ending in ' + esc(s.last4) + ', ' + from + ')';
        } else {
            box.innerHTML = '<span class="ai-dot"></span>Gemini is off. Paste a key below to turn it on.';
        }
        document.getElementById('gem-remove').style.display = s.has_saved ? '' : 'none';
    } catch (e) {
        box.textContent = 'Could not load the Gemini settings.';
    }
}

async function saveGeminiKey() {
    const input = document.getElementById('gem-key-input');
    const key = input.value.trim();
    if (!key) { setGemMsg('Paste your Gemini API key first.', false); return; }

    setGemMsg('Saving and testing...', true);
    try {
        const r = await apiRequest('/api/admin/gemini-key', { method: 'PUT', body: JSON.stringify({ api_key: key }) });
        input.value = '';
        await loadGeminiKey();
        if (r.test === 'ok') setGemMsg('Saved. The key works, so the assistant is on.', true);
        else if (r.test === 'rate_limited') setGemMsg('Saved, but Google says this key has no free requests available right now. Wait a few minutes, then try the assistant.', false);
        else if (r.test === 'unreachable' || r.test === 'timeout') setGemMsg('Saved, but the server could not reach Google to test it.', false);
        else if (r.test === 'no_model') setGemMsg('Saved, but no suitable Gemini model was found for this key.', false);
        else setGemMsg('Saved, but the test returned an error (' + String(r.test).replace('error_', '') + ').', false);
    } catch (e) {
        setGemMsg((e.message || '').replace(/^HTTP \d+\s*/, '') || 'Could not save the key.', false);
    }
}

async function removeGeminiKey() {
    if (!confirm('Remove the saved Gemini key? The assistant will switch to Anthropic if a key is set there, otherwise it turns off.')) return;
    try {
        await apiRequest('/api/admin/gemini-key', { method: 'DELETE' });
        await loadGeminiKey();
        setGemMsg('Saved key removed.', true);
    } catch (e) {
        setGemMsg('Could not remove the key.', false);
    }
}


// ---------- Groq key ----------

function setGroqMsg(text, ok) {
    const el = document.getElementById('groq-msg');
    el.textContent = text;
    el.className = 'ai-msg ' + (ok ? 'ok' : 'err');
}

async function loadGroqKey() {
    const box = document.getElementById('groq-status');
    try {
        const s = await apiRequest('/api/admin/groq-key');
        if (s.configured) {
            const from = s.source === 'render' ? 'set in Render' : 'saved from this panel';
            box.innerHTML = '<span class="ai-dot on"></span>Groq is on (key ending in ' + esc(s.last4) + ', ' + from + ')';
        } else {
            box.innerHTML = '<span class="ai-dot"></span>Groq is off. Paste a key below to turn it on.';
        }
        document.getElementById('groq-remove').style.display = s.has_saved ? '' : 'none';
    } catch (e) {
        box.textContent = 'Could not load the Groq settings.';
    }
}

async function saveGroqKey() {
    const input = document.getElementById('groq-key-input');
    const key = input.value.trim();
    if (!key) { setGroqMsg('Paste your Groq API key first.', false); return; }

    setGroqMsg('Saving and testing...', true);
    try {
        const r = await apiRequest('/api/admin/groq-key', { method: 'PUT', body: JSON.stringify({ api_key: key }) });
        input.value = '';
        await loadGroqKey();
        if (r.test === 'ok') setGroqMsg('Saved. The key works, so ChatWave AI is on.', true);
        else if (r.test === 'rate_limited') setGroqMsg('Saved, but Groq says this key has hit its free limit for now. Wait a few minutes, then try the assistant.', false);
        else if (r.test === 'unreachable' || r.test === 'timeout') setGroqMsg('Saved, but the server could not reach Groq to test it.', false);
        else if (r.test === 'no_model') setGroqMsg('Saved, but no suitable model was found for this key.', false);
        else setGroqMsg('Saved, but the test returned an error (' + String(r.test).replace('error_', '') + ').', false);
    } catch (e) {
        setGroqMsg((e.message || '').replace(/^HTTP \d+\s*/, '') || 'Could not save the key.', false);
    }
}

async function removeGroqKey() {
    if (!confirm('Remove the saved Groq key? The assistant will switch to Gemini or Anthropic if a key is set there, otherwise it turns off.')) return;
    try {
        await apiRequest('/api/admin/groq-key', { method: 'DELETE' });
        await loadGroqKey();
        setGroqMsg('Saved key removed.', true);
    } catch (e) {
        setGroqMsg('Could not remove the key.', false);
    }
}
