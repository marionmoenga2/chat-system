/**
 * Group chats. Plugs into chat.js (which must load first).
 * It reads chat.js globals (users, currentUser, ws, replyingTo, ...) and wraps a few
 * chat.js functions, so one-to-one chats keep working exactly as before.
 */
(function () {
    'use strict';

    let groups = [];
    let selectedGroupId = null;
    let activeTab = 'chats';
    let groupUnread = {};
    let infoData = null;

    const $ = (id) => document.getElementById(id);
    const plural = (n) => `${n} member${n === 1 ? '' : 's'}`;
    const initialOf = (name) => escapeHtml((name || '?').charAt(0).toUpperCase());
    const groupGradient = (name) => avatarGradient('group:' + name);

    // ---------- Hook into chat.js ----------

    const originalHandleWs = window.handleWebSocketMessage;
    window.handleWebSocketMessage = function (data) {
        if (data && data.type === 'group_message') { onGroupMessage(data); return; }
        if (data && data.type === 'group_update') { loadGroups(); return; }
        return originalHandleWs(data);
    };

    const originalSelectUser = window.selectUser;
    window.selectUser = function (user) {
        if (selectedGroupId !== null) {
            selectedGroupId = null;
            document.querySelectorAll('#groups-list .group-item').forEach(el => el.classList.remove('active'));
        }
        return originalSelectUser(user);
    };

    const originalSendMessage = window.sendMessage;
    window.sendMessage = function () {
        if (selectedGroupId === null) return originalSendMessage();

        const input = $('message-input');
        const content = input.value.trim();
        if (!content) return;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showNotification('Not connected yet. The server may be waking up, try again in a moment.');
            return;
        }

        const payload = { type: 'group', group_id: selectedGroupId, content: content };
        if (replyingTo) payload.reply_to_id = replyingTo.id;

        ws.send(JSON.stringify(payload));
        input.value = '';
        cancelReply();
        input.focus();
    };

    const originalFilterUsers = window.filterUsers;
    window.filterUsers = function () {
        if (activeTab === 'groups') { filterGroups(); return; }
        return originalFilterUsers();
    };

    // ---------- Page setup ----------

    function init() {
        injectUi();
        if (localStorage.getItem('token')) {
            loadGroups();
            setInterval(loadGroups, 15000);
        }
    }

    function injectUi() {
        const usersList = $('users-list');
        if (!usersList) return;

        // Tabs between the search box and the list
        const tabs = document.createElement('div');
        tabs.className = 'sidebar-tabs';
        tabs.innerHTML = `
            <button type="button" class="sidebar-tab active" data-tab="chats">Chats</button>
            <button type="button" class="sidebar-tab" data-tab="groups">Groups <span class="tab-badge" id="groups-badge" hidden></span></button>
        `;
        usersList.parentNode.insertBefore(tabs, usersList);
        tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.sidebar-tab');
            if (tab) switchTab(tab.dataset.tab);
        });

        // Groups pane after the users list
        const pane = document.createElement('div');
        pane.className = 'groups-pane';
        pane.id = 'groups-pane';
        pane.innerHTML = `
            <button type="button" class="new-group-btn" id="new-group-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                New group
            </button>
            <div class="users-list" id="groups-list"></div>
        `;
        usersList.parentNode.appendChild(pane);
        $('new-group-btn').addEventListener('click', openCreateGroup);

        // Dialogs
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal-backdrop" id="cg-modal">
                <div class="fx-card" role="dialog" aria-modal="true" aria-labelledby="cg-title">
                    <h3 id="cg-title">New group</h3>
                    <p class="fx-sub">Give the group a name and choose who to add.</p>
                    <label class="fx-label" for="cg-name">Group name</label>
                    <input class="fx-input" id="cg-name" maxlength="60" placeholder="For example: Project team" autocomplete="off">
                    <span class="fx-label">Members</span>
                    <div class="pick-list" id="cg-members"></div>
                    <div class="fx-actions">
                        <button type="button" class="fx-btn ghost" id="cg-cancel">Cancel</button>
                        <button type="button" class="fx-btn primary" id="cg-create">Create group</button>
                    </div>
                </div>
            </div>

            <div class="modal-backdrop" id="gi-modal">
                <div class="fx-card" role="dialog" aria-modal="true" id="gi-body"></div>
            </div>
        `);

        $('cg-cancel').addEventListener('click', closeCreateGroup);
        $('cg-create').addEventListener('click', createGroup);
        $('cg-modal').addEventListener('click', (e) => { if (e.target === $('cg-modal')) closeCreateGroup(); });
        $('gi-modal').addEventListener('click', (e) => { if (e.target === $('gi-modal')) closeInfo(); });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if ($('cg-modal').classList.contains('open')) closeCreateGroup();
            if ($('gi-modal').classList.contains('open')) closeInfo();
        });
    }

    function switchTab(tab) {
        activeTab = tab;
        document.querySelectorAll('.sidebar-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
        });
        $('users-list').style.display = tab === 'chats' ? '' : 'none';
        $('groups-pane').classList.toggle('show', tab === 'groups');
        $('user-search').placeholder = tab === 'groups' ? 'Search groups...' : 'Search people...';
        window.filterUsers();
    }

    // ---------- Groups list ----------

    async function loadGroups() {
        const data = await apiGet('/api/groups/');
        if (!data) return;
        groups = data;

        // Removed from the group we were viewing?
        if (selectedGroupId !== null && !groups.some(g => g.id === selectedGroupId)) {
            selectedGroupId = null;
            closeInfo();
            resetConversation();
            showNotification('You are no longer in that group');
        }

        renderGroupsList();

        const open = groups.find(g => g.id === selectedGroupId);
        if (open) renderGroupHeader(open);
    }

    function sortGroups() {
        const key = (g) => (g.last_message ? g.last_message.timestamp : g.created_at) || '';
        groups.sort((a, b) => key(b).localeCompare(key(a)));
    }

    function renderGroupsList() {
        const list = $('groups-list');
        if (!list) return;
        list.innerHTML = '';

        if (!groups.length) {
            list.innerHTML = '<div class="empty-state">No groups yet.<br>Create one to chat with several people.</div>';
            updateBadges();
            return;
        }

        groups.forEach(g => {
            const unread = groupUnread[g.id] || 0;
            const preview = g.last_message
                ? `${g.last_message.sender_username}: ${g.last_message.content}`
                : plural(g.member_count);

            const div = document.createElement('div');
            div.className = 'user-item group-item' + (g.id === selectedGroupId ? ' active' : '');
            div.dataset.groupId = g.id;
            div.onclick = () => openGroup(g.id);
            div.innerHTML = `
                <div class="user-avatar group-avatar" style="background:${groupGradient(g.name)}">
                    <span class="avatar-initial">${initialOf(g.name)}</span>
                </div>
                <div class="user-details">
                    <div class="user-name">${escapeHtml(g.name)}</div>
                    <div class="user-status">${escapeHtml(preview)}</div>
                </div>
                ${unread ? `<span class="unread-badge">${unread}</span>` : ''}
            `;
            list.appendChild(div);
        });

        filterGroups();
        updateBadges();
    }

    function filterGroups() {
        const q = $('user-search').value.trim().toLowerCase();
        document.querySelectorAll('#groups-list .group-item').forEach(el => {
            const name = el.querySelector('.user-name').textContent.toLowerCase();
            el.style.display = name.includes(q) ? 'flex' : 'none';
        });
    }

    function updateBadges() {
        const total = Object.values(groupUnread).reduce((a, b) => a + b, 0);
        const badge = $('groups-badge');
        if (!badge) return;
        badge.textContent = total;
        badge.hidden = total === 0;
    }

    // ---------- Open a group conversation ----------

    async function openGroup(id) {
        const g = groups.find(x => x.id === id);
        if (!g) return;

        selectedGroupId = id;
        selectedUserId = null;           // leave any one-to-one chat
        cancelReply();
        groupUnread[id] = 0;
        renderGroupsList();
        document.querySelectorAll('#users-list .user-item').forEach(el => el.classList.remove('active'));

        renderGroupHeader(g);
        $('typing-indicator').textContent = '';
        $('message-input-area').style.display = 'block';
        $('chat-app').classList.add('chat-open');
        $('mobile-chat-title').textContent = g.name;

        const container = $('messages-container');
        container.innerHTML = '<div class="empty-state">Loading...</div>';

        const msgs = await apiGet(`/api/groups/${id}/messages?limit=100`);
        if (selectedGroupId !== id) return;   // switched to something else while loading

        if (!msgs) {
            container.innerHTML = '<div class="empty-state">Could not load messages</div>';
            return;
        }
        container.innerHTML = '';
        if (!msgs.length) {
            container.innerHTML = '<div class="empty-state">No messages yet. Say hello!</div>';
            return;
        }
        msgs.forEach(m => appendGroupMessage(m));
        scrollToBottom();
    }

    function renderGroupHeader(g) {
        $('chat-header').innerHTML = `
            <div class="header-profile" role="button" tabindex="0" id="group-header-btn">
                <div class="header-avatar group-avatar" style="background:${groupGradient(g.name)}">
                    <span class="avatar-initial">${initialOf(g.name)}</span>
                </div>
                <div class="chat-header-info">
                    <h3>${escapeHtml(g.name)}</h3>
                    <span class="user-status">${plural(g.member_count)} &middot; tap for info</span>
                </div>
            </div>
        `;
        const btn = $('group-header-btn');
        btn.addEventListener('click', openInfo);
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter') openInfo(); });
    }

    function resetConversation() {
        $('chat-header').innerHTML = '<h3>Select a chat to start messaging</h3>';
        $('message-input-area').style.display = 'none';
        $('messages-container').innerHTML = '<div class="empty-state">Pick a person or a group from the sidebar</div>';
        $('chat-app').classList.remove('chat-open');
    }

    function appendGroupMessage(msg) {
        const isSent = msg.sender_id === currentUser.id;
        appendMessage(msg, isSent);   // chat.js draws the bubble, quote and reply button

        if (isSent) return;
        const el = $('messages-container').querySelector(`[data-msg-id="${msg.id}"]`);
        if (!el || el.querySelector('.group-sender')) return;

        const tag = document.createElement('div');
        tag.className = 'group-sender';
        tag.textContent = msg.sender_username;
        tag.style.color = avatarColors(msg.sender_username)[0];
        el.insertBefore(tag, el.firstChild);
    }

    function onGroupMessage(data) {
        const mine = data.sender_id === currentUser.id;
        const g = groups.find(x => x.id === data.group_id);
        const viewing = selectedGroupId === data.group_id;

        if (!g) {
            loadGroups();   // a group we haven't seen yet
        } else {
            g.last_message = {
                sender_username: data.sender_username,
                content: (data.content || '').slice(0, 80),
                timestamp: data.timestamp
            };
            sortGroups();
            if (!viewing && !mine) {
                groupUnread[g.id] = (groupUnread[g.id] || 0) + 1;
                showNotification(`${g.name}: new message from ${data.sender_username}`);
            }
            renderGroupsList();
        }

        if (viewing) appendGroupMessage(data);
    }

    // ---------- Create a group ----------

    function pickRow(u) {
        return `
            <label class="pick-row">
                <span class="pick-avatar" style="background:${avatarGradient(u.username)}">${avatarHtml(u.id, u.username)}</span>
                <span class="pick-name">${escapeHtml(u.username)}</span>
                <input type="checkbox" value="${u.id}">
            </label>`;
    }

    function openCreateGroup() {
        if (!users.length) {
            showNotification('There is nobody else to add yet');
            return;
        }
        $('cg-name').value = '';
        $('cg-members').innerHTML = users.map(pickRow).join('');
        $('cg-modal').classList.add('open');
        $('cg-name').focus();
    }

    function closeCreateGroup() {
        $('cg-modal').classList.remove('open');
    }

    async function createGroup() {
        const name = $('cg-name').value.trim().replace(/\s+/g, ' ');
        const ids = Array.from($('cg-members').querySelectorAll('input:checked')).map(i => Number(i.value));

        if (!name) { showNotification('Give the group a name'); return; }
        if (!ids.length) { showNotification('Pick at least one person to add'); return; }

        const btn = $('cg-create');
        btn.disabled = true;
        btn.textContent = 'Creating...';

        const res = await apiPost('/api/groups/', { name: name, member_ids: ids });

        btn.disabled = false;
        btn.textContent = 'Create group';

        if (res && res.id) {
            closeCreateGroup();
            await loadGroups();
            switchTab('groups');
            openGroup(res.id);
        } else {
            showNotification('Could not create the group. Please try again.');
        }
    }

    // ---------- Group info (members, rename, add, leave) ----------

    async function openInfo() {
        if (selectedGroupId === null) return;
        const id = selectedGroupId;

        $('gi-body').innerHTML = '<p class="fx-sub">Loading...</p>';
        $('gi-modal').classList.add('open');

        const data = await apiGet(`/api/groups/${id}`);
        if (!data) {
            closeInfo();
            showNotification('Could not load the group info');
            return;
        }
        if (selectedGroupId !== id) return;

        infoData = data;
        renderInfo();
    }

    function closeInfo() {
        const modal = $('gi-modal');
        if (modal) modal.classList.remove('open');
        infoData = null;
    }

    function memberRow(m, canRemove) {
        return `
            <div class="member-row">
                <span class="pick-avatar" style="background:${avatarGradient(m.username)}">${avatarHtml(m.id, m.username)}</span>
                <span class="member-name">${escapeHtml(m.username)}${m.id === currentUser.id ? ' (you)' : ''}</span>
                ${m.is_admin ? '<span class="role-badge">Admin</span>' : ''}
                ${canRemove && m.id !== currentUser.id
                    ? `<button type="button" class="member-remove" data-remove="${m.id}" aria-label="Remove member">&times;</button>`
                    : ''}
            </div>`;
    }

    function renderInfo() {
        const g = infoData;
        if (!g) return;

        const memberIds = new Set(g.members.map(m => m.id));
        const candidates = users.filter(u => !memberIds.has(u.id));

        $('gi-body').innerHTML = `
            <h3>${escapeHtml(g.name)}</h3>
            <p class="fx-sub">${plural(g.member_count)}</p>

            ${g.is_admin ? `
                <label class="fx-label" for="gi-name">Group name</label>
                <div class="inline-row">
                    <input class="fx-input" id="gi-name" maxlength="60" autocomplete="off">
                    <button type="button" class="fx-btn primary small" id="gi-rename">Save</button>
                </div>` : ''}

            <span class="fx-label">Members</span>
            <div>${g.members.map(m => memberRow(m, g.is_admin)).join('')}</div>

            ${g.is_admin && candidates.length ? `
                <span class="fx-label">Add people</span>
                <div class="pick-list" id="gi-candidates">${candidates.map(pickRow).join('')}</div>
                <div class="fx-actions"><button type="button" class="fx-btn primary" id="gi-add">Add selected</button></div>` : ''}

            <div class="fx-actions">
                <button type="button" class="fx-btn ghost" id="gi-close">Close</button>
                <button type="button" class="fx-btn danger" id="gi-leave">Leave group</button>
            </div>
        `;

        // Set the name through the DOM (not HTML), so quotes in names can't break the page
        const nameInput = $('gi-name');
        if (nameInput) nameInput.value = g.name;

        $('gi-close').addEventListener('click', closeInfo);
        $('gi-leave').addEventListener('click', leaveGroup);
        if ($('gi-rename')) $('gi-rename').addEventListener('click', renameGroup);
        if ($('gi-add')) $('gi-add').addEventListener('click', addMembers);
        $('gi-body').querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => removeMember(Number(btn.dataset.remove)));
        });
    }

    async function refreshInfo() {
        const id = selectedGroupId;
        if (id === null) return;
        const data = await apiGet(`/api/groups/${id}`);
        if (data && selectedGroupId === id && $('gi-modal').classList.contains('open')) {
            infoData = data;
            renderInfo();
        }
        loadGroups();
    }

    async function renameGroup() {
        const name = $('gi-name').value.trim().replace(/\s+/g, ' ');
        if (!name) { showNotification('The group needs a name'); return; }

        const res = await apiPut(`/api/groups/${selectedGroupId}`, { name: name });
        if (res && res.ok) {
            showNotification('Group renamed');
            refreshInfo();
        } else {
            showNotification('Could not rename the group');
        }
    }

    async function addMembers() {
        const ids = Array.from($('gi-candidates').querySelectorAll('input:checked')).map(i => Number(i.value));
        if (!ids.length) { showNotification('Pick at least one person'); return; }

        const res = await apiPost(`/api/groups/${selectedGroupId}/members`, { user_ids: ids });
        if (res && res.ok) {
            showNotification(`Added ${res.added} ${res.added === 1 ? 'person' : 'people'}`);
            refreshInfo();
        } else {
            showNotification('Could not add people');
        }
    }

    async function removeMember(userId) {
        if (!confirm('Remove this person from the group?')) return;

        const res = await apiDelete(`/api/groups/${selectedGroupId}/members/${userId}`);
        if (res) {
            showNotification('Member removed');
            refreshInfo();
        } else {
            showNotification('Could not remove that person');
        }
    }

    async function leaveGroup() {
        if (!confirm('Leave this group? You will stop receiving its messages.')) return;

        const id = selectedGroupId;
        const res = await apiDelete(`/api/groups/${id}/members/${currentUser.id}`);
        if (res) {
            closeInfo();
            selectedGroupId = null;
            resetConversation();
            await loadGroups();
            showNotification('You left the group');
        } else {
            showNotification('Could not leave the group');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();