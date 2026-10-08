/**
 * Lets people add or change their own phone number after signing up.
 * The number is private: only its owner can read or change it.
 * Loads after chat.js. Needs API_URL (config.js) and showNotification (chat.js).
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let myPhone;   // undefined = not loaded yet, null = none saved, otherwise the number

    const style = document.createElement('style');
    style.textContent = `
        .phone-toast { position: fixed; right: 16px; bottom: 16px; z-index: 2000; width: 320px; max-width: calc(100vw - 24px);
            display: none; background: #fff; color: #14213a; border: 1px solid #d5ddea; border-left: 4px solid #1f4fd8;
            border-radius: 12px; padding: 14px 16px; box-shadow: 0 12px 32px -10px rgba(14,34,64,.35); font-size: .92rem; line-height: 1.45; }
        .phone-toast.show { display: block; }
        .phone-toast strong { display: block; margin-bottom: 2px; }
        .phone-toast-actions { display: flex; gap: 8px; margin-top: 10px; }
        .phone-btn { font: inherit; font-size: .88rem; font-weight: 600; padding: 8px 14px; border: 0; border-radius: 8px;
            background: #1f4fd8; color: #fff; cursor: pointer; }
        .phone-btn:hover { background: #1840b3; }
        .phone-btn:disabled { opacity: .65; cursor: wait; }
        .phone-btn.ghost { background: #eef2f9; color: #33425b; }
        .phone-btn.ghost:hover { background: #e1e8f4; }
        .phone-backdrop { position: fixed; inset: 0; z-index: 3000; display: none; align-items: center; justify-content: center;
            padding: 16px; background: rgba(10,20,40,.55); }
        .phone-backdrop.open { display: flex; }
        .phone-card { width: 100%; max-width: 380px; background: #fff; color: #14213a; border-radius: 14px; padding: 24px;
            box-shadow: 0 24px 48px -16px rgba(0,0,0,.5); }
        .phone-card h3 { margin: 0 0 6px; font-size: 1.2rem; }
        .phone-card p { margin: 0 0 16px; color: #5b6b82; font-size: .9rem; }
        .phone-card label { display: block; margin-bottom: 6px; font-size: .85rem; font-weight: 600; }
        .phone-card input { width: 100%; height: 44px; padding: 0 12px; border: 1px solid #cdd6e4; border-radius: 8px; font: inherit; font-size: 1rem; }
        .phone-card input:focus { outline: none; border-color: #1f4fd8; box-shadow: 0 0 0 3px rgba(31,79,216,.18); }
        .phone-error { min-height: 1.2rem; margin-top: 8px; color: #b42318; font-size: .85rem; }
        .phone-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
        .phone-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 20px 16px;
            padding: 12px 14px; border: 1px solid #d5ddea; border-radius: 10px; background: #f6f8fc; color: #14213a; }
        .phone-label { font-size: .8rem; font-weight: 600; color: #5b6b82; }
        .phone-label span { margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #e4f5ec; color: #2f8f5b; font-size: .7rem; }
        .phone-value { margin-top: 2px; font-size: .95rem; }
    `;
    document.head.appendChild(style);

    function notify(message) {
        if (typeof showNotification === 'function') showNotification(message);
    }

    async function request(method, body) {
        const token = localStorage.getItem('token');
        if (!token || typeof API_URL === 'undefined') return { ok: false, status: 0, data: null };
        try {
            const res = await fetch(`${API_URL}/api/auth/me/phone`, {
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

    // Accept spaces, dashes and brackets; require international format like +254712345678
    function clean(value) {
        const digits = String(value || '').replace(/[\s\-().]/g, '');
        return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
    }

    function mask(p) {
        return p.slice(0, 4) + '\u2022'.repeat(Math.max(p.length - 7, 3)) + p.slice(-3);
    }

    function errorText(r) {
        if (r.status === 401) return 'Your session expired. Please sign in again.';
        const d = r.data && r.data.detail;
        if (typeof d === 'string') return d;
        if (Array.isArray(d)) return d.map(x => String(x.msg || '').replace(/^Value error, /, '')).join(' ');
        return 'Could not save the number. Please try again.';
    }

    // ---------- Page pieces ----------

    function build() {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="phone-toast" id="phone-toast" role="status">
                <strong>Add your phone number</strong>
                Other users never see it. Only site administrators can.
                <div class="phone-toast-actions">
                    <button type="button" class="phone-btn" id="phone-toast-add">Add number</button>
                    <button type="button" class="phone-btn ghost" id="phone-toast-later">Later</button>
                </div>
            </div>
            <div class="phone-backdrop" id="phone-modal" role="dialog" aria-modal="true" aria-labelledby="phone-title">
                <div class="phone-card">
                    <h3 id="phone-title">Your phone number</h3>
                    <p>Include your country code. Other users never see it; only site administrators can.</p>
                    <label for="phone-input">Phone number</label>
                    <input type="tel" id="phone-input" placeholder="+254 712 345 678" autocomplete="tel" inputmode="tel">
                    <div class="phone-error" id="phone-error" role="alert"></div>
                    <div class="phone-actions">
                        <button type="button" class="phone-btn ghost" id="phone-cancel">Cancel</button>
                        <button type="button" class="phone-btn" id="phone-save">Save</button>
                    </div>
                </div>
            </div>
        `);

        $('phone-toast-add').addEventListener('click', openModal);
        $('phone-toast-later').addEventListener('click', () => {
            sessionStorage.setItem('phone_prompt_dismissed', '1');
            $('phone-toast').classList.remove('show');
        });
        $('phone-cancel').addEventListener('click', closeModal);
        $('phone-save').addEventListener('click', save);
        $('phone-modal').addEventListener('click', (e) => { if (e.target.id === 'phone-modal') closeModal(); });
        $('phone-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && $('phone-modal').classList.contains('open')) closeModal();
        });
    }

    function openModal() {
        $('phone-error').textContent = '';
        $('phone-input').value = myPhone || '';
        $('phone-modal').classList.add('open');
        $('phone-input').focus();
    }

    function closeModal() {
        $('phone-modal').classList.remove('open');
    }

    async function save() {
        const err = $('phone-error');
        const phone = clean($('phone-input').value);
        if (!phone) {
            err.textContent = 'Enter your number with the country code, for example +254712345678.';
            return;
        }
        const btn = $('phone-save');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        const r = await request('PUT', { phone: phone });
        btn.disabled = false;
        btn.textContent = 'Save';

        if (r.ok && r.data && r.data.phone) {
            myPhone = r.data.phone;
            closeModal();
            refreshUi();
            notify('Phone number saved');
        } else {
            err.textContent = errorText(r);
        }
    }

    function paintRow(row) {
        let value = 'Loading...';
        if (myPhone) value = mask(myPhone);
        else if (myPhone === null) value = 'Not added';
        row.innerHTML = `
            <div>
                <div class="phone-label">Phone number<span>Private</span></div>
                <div class="phone-value">${value}</div>
            </div>
            <button type="button" class="phone-btn ghost">${myPhone ? 'Change' : 'Add'}</button>
        `;
        row.querySelector('button').addEventListener('click', openModal);
    }

    function refreshUi() {
        const row = $('phone-row');
        if (row) paintRow(row);
        const show = myPhone === null && !sessionStorage.getItem('phone_prompt_dismissed');
        $('phone-toast').classList.toggle('show', show);
    }

    async function load() {
        const r = await request('GET');
        if (r.ok) myPhone = (r.data && r.data.phone) || null;
        refreshUi();
    }

    // ---------- Your own profile card ----------

    function placeRow(isSelf) {
        const existing = $('phone-row');
        if (existing) existing.remove();
        const card = $('profile-card');
        if (!isSelf || !card) return;

        const row = document.createElement('div');
        row.className = 'phone-row';
        row.id = 'phone-row';
        paintRow(row);
        card.appendChild(row);
        if (myPhone === undefined) load();
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
