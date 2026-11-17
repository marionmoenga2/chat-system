/**
 * Lets people change their own email address from their profile card.
 * Needs the current password. Loads after phone.js and chat.js.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let myEmail;   // undefined = not loaded yet

    function notify(message) {
        if (typeof showNotification === 'function') showNotification(message);
    }

    async function request(method, body) {
        const token = localStorage.getItem('token');
        if (!token || typeof API_URL === 'undefined') return { ok: false, status: 0, data: null };
        try {
            const res = await fetch(`${API_URL}/api/auth/me/email`, {
                method: method,
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: body ? JSON.stringify(body) : undefined
            });
            let data = null;
            try { data = await res.json(); } catch (e) { /* no body */ }
            return { ok: res.ok, status: res.status, data: data };
        } catch (e) {
            return { ok: false, status: 0, data: null };
        }
    }

    function validEmail(v) {
        return v.length <= 100 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
    }

    function errorText(r) {
        if (r.status === 401) return 'Your session expired. Please sign in again.';
        const d = r.data && r.data.detail;
        if (typeof d === 'string') return d;
        if (Array.isArray(d)) return d.map(x => String(x.msg || '').replace(/^Value error, /, '')).join(' ');
        return 'Could not save the email. Please try again.';
    }

    function build() {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="phone-backdrop" id="email-modal" role="dialog" aria-modal="true" aria-labelledby="email-title">
                <div class="phone-card">
                    <h3 id="email-title">Change your email</h3>
                    <p>Enter your new email address and your current password to confirm it is you.</p>
                    <label for="email-input">New email address</label>
                    <input type="email" id="email-input" placeholder="name@example.com" autocomplete="email">
                    <label for="email-password" style="margin-top:12px">Current password</label>
                    <input type="password" id="email-password" autocomplete="current-password">
                    <div class="phone-error" id="email-error" role="alert"></div>
                    <div class="phone-actions">
                        <button type="button" class="phone-btn ghost" id="email-cancel">Cancel</button>
                        <button type="button" class="phone-btn" id="email-save">Save</button>
                    </div>
                </div>
            </div>
        `);
        $('email-cancel').addEventListener('click', closeModal);
        $('email-save').addEventListener('click', save);
        $('email-modal').addEventListener('click', (e) => { if (e.target.id === 'email-modal') closeModal(); });
        $('email-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && $('email-modal').classList.contains('open')) closeModal();
        });
    }

    function openModal() {
        $('email-error').textContent = '';
        $('email-input').value = myEmail || '';
        $('email-password').value = '';
        $('email-modal').classList.add('open');
        $('email-input').focus();
    }

    function closeModal() {
        $('email-modal').classList.remove('open');
        $('email-password').value = '';
    }

    async function save() {
        const err = $('email-error');
        const email = $('email-input').value.trim().toLowerCase();
        const password = $('email-password').value;
        if (!validEmail(email)) { err.textContent = 'Enter a valid email address.'; return; }
        if (!password) { err.textContent = 'Enter your current password.'; return; }
        if (email === (myEmail || '').toLowerCase()) { err.textContent = 'That is already your email.'; return; }

        const btn = $('email-save');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        const r = await request('PUT', { email: email, current_password: password });
        btn.disabled = false;
        btn.textContent = 'Save';

        if (r.ok && r.data && r.data.email) {
            myEmail = r.data.email;
            try {
                const u = JSON.parse(localStorage.getItem('user') || 'null');
                if (u) { u.email = myEmail; localStorage.setItem('user', JSON.stringify(u)); }
            } catch (e) { /* ignore */ }
            closeModal();
            const row = $('email-row');
            if (row) paintRow(row);
            notify('Email updated');
        } else {
            err.textContent = errorText(r);
        }
    }

    function paintRow(row) {
        row.innerHTML = `
            <div>
                <div class="phone-label">Email address</div>
                <div class="phone-value"></div>
            </div>
            <button type="button" class="phone-btn ghost">Change</button>
        `;
        row.querySelector('.phone-value').textContent =
            myEmail === undefined ? 'Loading...' : (myEmail || 'Not added');
        row.querySelector('button').addEventListener('click', openModal);
    }

    async function load() {
        const r = await request('GET');
        if (r.ok) myEmail = (r.data && r.data.email) || '';
        const row = $('email-row');
        if (row) paintRow(row);
    }

    function placeRow(isSelf) {
        const existing = $('email-row');
        if (existing) existing.remove();
        const card = $('profile-card');
        if (!isSelf || !card) return;

        const row = document.createElement('div');
        row.className = 'phone-row';
        row.id = 'email-row';
        paintRow(row);
        card.appendChild(row);
        if (myEmail === undefined) load();
    }

    const originalShowProfile = window.showProfile;
    if (typeof originalShowProfile === 'function') {
        window.showProfile = function (userId) {
            const result = originalShowProfile.apply(this, arguments);
            placeRow(typeof currentUser !== 'undefined' && !!currentUser && Number(userId) === currentUser.id);
            return result;
        };
    }

    function init() {
        if (!localStorage.getItem('token')) return;
        build();
        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
