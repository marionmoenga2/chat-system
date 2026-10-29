/* Pending approvals tab for the admin dashboard */
(function () {
    var BASE = (typeof API_URL !== 'undefined') ? API_URL : 'http://localhost:8000';

    function esc(text) {
        var d = document.createElement('div');
        d.textContent = text == null ? '' : String(text);
        return d.innerHTML;
    }

    function when(value) {
        if (!value) return '';
        var s = String(value);
        if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
        var d = new Date(s);
        return isNaN(d) ? '' : d.toLocaleString();
    }

    async function api(path, options) {
        var res = await fetch(BASE + path, Object.assign({}, options || {}, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('admin_token')
            }
        }));
        if (res.status === 401 || res.status === 403) {
            if (typeof logout === 'function') logout();
            throw new Error('Not authorised');
        }
        if (!res.ok) {
            var detail = '';
            try { detail = (await res.json()).detail || ''; } catch (e) { /* no JSON body */ }
            throw new Error(('HTTP ' + res.status + ' ' + detail).trim());
        }
        return res.json();
    }

    function setBadge(n) {
        var b = document.getElementById('pending-badge');
        if (!b) return;
        b.textContent = n;
        b.classList.toggle('hidden', !n);
    }

    async function refreshBadge() {
        try {
            var s = await api('/api/admin/stats');
            setBadge(s.pending_users || 0);
        } catch (e) { /* ignore, badge just stays as it was */ }
    }

    window.loadPending = async function () {
        var tbody = document.querySelector('#pending-table tbody');
        var empty = document.getElementById('pending-empty');
        if (!tbody) return;
        try {
            var users = await api('/api/admin/pending-users');
            tbody.innerHTML = '';
            users.forEach(function (u) {
                var id = Number(u.id);
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + id + '</td>' +
                    '<td>' + esc(u.username) + '</td>' +
                    '<td>' + esc(u.email) + '</td>' +
                    '<td>' + esc(u.phone || '-') + '</td>' +
                    '<td>' + esc(when(u.created_at)) + '</td>' +
                    '<td class="actions">' +
                    '<button type="button" class="btn btn-success" data-pending-action="approve" data-id="' + id + '">Approve</button>' +
                    '<button type="button" class="btn btn-danger" data-pending-action="reject" data-id="' + id + '">Reject</button>' +
                    '</td>';
                tbody.appendChild(tr);
            });
            empty.classList.toggle('hidden', users.length > 0);
            setBadge(users.length);
        } catch (e) {
            console.error('Failed to load pending users:', e);
        }
    };

    document.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-pending-action]');
        if (!btn) return;
        var action = btn.dataset.pendingAction;
        var id = Number(btn.dataset.id);
        if (action === 'reject' && !confirm('Reject this sign-up? The pending account will be removed.')) return;
        btn.disabled = true;
        try {
            await api('/api/admin/users/' + id + '/' + action, { method: 'POST' });
        } catch (err) {
            alert('Could not ' + action + ' the user: ' + err.message);
        }
        window.loadPending();
        if (typeof loadStats === 'function') loadStats();
    });

    // Open the tab: reuse the dashboard's own showSection, then load the list
    if (typeof showSection === 'function') {
        var original = showSection;
        window.showSection = function (name) {
            original(name);
            if (name === 'pending') window.loadPending();
        };
    }

    if (localStorage.getItem('admin_token')) {
        refreshBadge();
        setInterval(refreshBadge, 30000);
    }
})();
