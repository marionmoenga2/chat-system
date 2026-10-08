/**
 * Chat wallpaper: each person can choose or create the background of their chats.
 * Saved in this browser (per account), so it is private and your photo is never uploaded.
 * Plugs into chat.html; needs chat.js loaded first (it uses showNotification).
 */
(function () {
    'use strict';

    // Vivid three-color wallpapers. The first one is the default.
    const PRESETS = [
        { id: 'electric', name: 'Electric', colorA: '#4f46e5', colorC: '#8b5cf6', colorB: '#ec4899', useC: true, angle: 135, pattern: 'dots' },
        { id: 'sunset',   name: 'Sunset',   colorA: '#ff6a3d', colorC: '#ff3d77', colorB: '#9333ea', useC: true, angle: 160, pattern: 'waves' },
        { id: 'ocean',    name: 'Ocean',    colorA: '#06b6d4', colorC: '#3b82f6', colorB: '#4f46e5', useC: true, angle: 200, pattern: 'waves' },
        { id: 'tropical', name: 'Tropical', colorA: '#22d3ee', colorC: '#34d399', colorB: '#a3e635', useC: true, angle: 135, pattern: 'doodle' },
        { id: 'candy',    name: 'Candy',    colorA: '#f472b6', colorC: '#c084fc', colorB: '#60a5fa', useC: true, angle: 150, pattern: 'dots' },
        { id: 'flame',    name: 'Flame',    colorA: '#f59e0b', colorC: '#ef4444', colorB: '#be185d', useC: true, angle: 145, pattern: 'lines' },
        { id: 'emerald',  name: 'Emerald',  colorA: '#10b981', colorC: '#14b8a6', colorB: '#0ea5e9', useC: true, angle: 135, pattern: 'grid' },
        { id: 'grape',    name: 'Grape',    colorA: '#7c3aed', colorC: '#a855f7', colorB: '#ec4899', useC: true, angle: 160, pattern: 'doodle' },
        { id: 'lime',     name: 'Lime pop', colorA: '#facc15', colorC: '#a3e635', colorB: '#22c55e', useC: true, angle: 135, pattern: 'doodle' },
        { id: 'rose',     name: 'Rose gold', colorA: '#fda4af', colorC: '#fb7185', colorB: '#f59e0b', useC: true, angle: 135, pattern: 'waves' },
        { id: 'midnight', name: 'Midnight', colorA: '#1e1b4b', colorC: '#4338ca', colorB: '#7c3aed', useC: true, angle: 160, pattern: 'dots' },
        { id: 'neon',     name: 'Neon night', colorA: '#0f172a', colorC: '#1d4ed8', colorB: '#06b6d4', useC: true, angle: 180, pattern: 'grid' }
    ];

    const PATTERN_LABELS = { none: 'None', dots: 'Dots', grid: 'Grid', lines: 'Lines', waves: 'Waves', doodle: 'Doodle' };

    const DEFAULTS = {
        colorA: PRESETS[0].colorA, colorB: PRESETS[0].colorB, colorC: PRESETS[0].colorC, useC: true,
        angle: PRESETS[0].angle, pattern: PRESETS[0].pattern,
        image: null, dim: 0.15, blur: 0, presetId: PRESETS[0].id
    };

    const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
    const HEX_RE = /^#[0-9a-fA-F]{6}$/;

    const ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

    const STYLE = `
        .chat-main { position: relative; }
        #wallpaper-layer { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
        .chat-main > :not(#wallpaper-layer) { position: relative; z-index: 1; }

        .wp-base, .wp-glow, .wp-pattern, .wp-dim { position: absolute; inset: 0; }
        .wp-base { background-size: cover; background-position: center; }
        .wp-glow {
            background:
                radial-gradient(circle at 15% 10%, rgba(255, 255, 255, 0.30), transparent 42%),
                radial-gradient(circle at 88% 92%, rgba(255, 255, 255, 0.20), transparent 48%);
        }
        .wp-pattern { background-repeat: repeat; }

        /* Keep the "pick a chat" message readable on any wallpaper */
        .chat-main.has-wallpaper .messages-container .empty-state {
            max-width: 340px;
            margin: auto;
            padding: 1.25rem 1.5rem;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.92);
            box-shadow: 0 10px 24px -14px rgba(15, 23, 42, 0.5);
        }

        /* A light outline keeps bubbles easy to see on strong colors */
        .chat-main.has-wallpaper .message.sent {
            box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6), 0 10px 20px -10px rgba(0, 0, 0, 0.5);
        }
        .chat-main.has-wallpaper .message.received {
            box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.45);
        }

        .wp-open {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            width: 36px;
            height: 36px;
            padding: 0;
            border: none;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.22);
            color: #fff;
            cursor: pointer;
            transition: background-color 0.2s, transform 0.15s;
        }
        .wp-open:hover { background: rgba(255, 255, 255, 0.38); transform: scale(1.06); }
        .wp-open svg { width: 18px; height: 18px; }
        .mobile-bar .wp-open { margin-left: auto; }

        .wp-card { max-width: 460px; }

        .wp-preview {
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 0.5rem;
            height: 170px;
            padding: 0.9rem;
            overflow: hidden;
            border: 1px solid #e8edf5;
            border-radius: 16px;
        }
        .wp-layer { position: absolute; inset: 0; }

        .wp-bubble {
            position: relative;
            z-index: 1;
            max-width: 78%;
            padding: 0.5rem 0.85rem;
            border-radius: 16px;
            font-size: 0.88rem;
            line-height: 1.35;
        }
        .wp-bubble.recv { align-self: flex-start; background: #fff; color: #0f172a; border-bottom-left-radius: 5px; box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.45); }
        .wp-bubble.sent { align-self: flex-end; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #fff; border-bottom-right-radius: 5px; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6), 0 10px 20px -10px rgba(0, 0, 0, 0.5); }

        .wp-swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }

        .wp-swatch {
            padding: 0.2rem;
            border: 2px solid transparent;
            border-radius: 14px;
            background: none;
            cursor: pointer;
            text-align: center;
            transition: border-color 0.2s, transform 0.15s;
        }
        .wp-swatch:hover { transform: translateY(-1px); }
        .wp-swatch.active { border-color: #6366f1; }
        .wp-mini { position: relative; height: 52px; overflow: hidden; border-radius: 10px; }
        .wp-swatch span { display: block; margin-top: 0.25rem; font-size: 0.68rem; font-weight: 600; color: #64748b; }

        .wp-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.8rem; }

        .wp-color { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; font-weight: 600; color: #475569; }
        .wp-color input[type="color"] { width: 46px; height: 34px; padding: 0; border: none; border-radius: 8px; background: none; cursor: pointer; }
        .wp-color input[type="checkbox"] { width: 17px; height: 17px; accent-color: #6366f1; }

        .wp-slider { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.7rem; font-size: 0.85rem; font-weight: 600; color: #475569; }
        .wp-slider > span:first-child { width: 78px; flex-shrink: 0; }
        .wp-slider input[type="range"] { flex: 1; min-width: 0; accent-color: #6366f1; }
        .wp-slider output { width: 42px; text-align: right; color: #64748b; font-weight: 500; }

        .wp-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.8rem; }
        .wp-chip {
            padding: 0.38rem 0.85rem;
            border: 1px solid #e2e8f0;
            border-radius: 999px;
            background: #fff;
            color: #475569;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
        }
        .wp-chip.active { border-color: #6366f1; background: #eef2ff; color: #4338ca; }

        .wp-photo-controls[hidden] { display: none; }
        .wp-note { margin-top: 0.5rem; font-size: 0.78rem; color: #94a3b8; }

        @media (max-width: 480px) {
            .wp-swatches { grid-template-columns: repeat(3, 1fr); }
            .wp-preview { height: 150px; }
        }
    `;

    let layer = null;
    let chatMain = null;
    let draft = null;

    const $ = (id) => document.getElementById(id);

    // ---------- Saved settings ----------

    function storageKey() {
        try {
            const u = JSON.parse(localStorage.getItem('user') || 'null');
            return 'cw_wallpaper_' + (u && u.id ? u.id : 'guest');
        } catch (e) {
            return 'cw_wallpaper_guest';
        }
    }

    function clean(s) {
        const out = Object.assign({}, DEFAULTS, s || {});
        if (!HEX_RE.test(out.colorA)) out.colorA = DEFAULTS.colorA;
        if (!HEX_RE.test(out.colorB)) out.colorB = DEFAULTS.colorB;
        if (!HEX_RE.test(out.colorC)) out.colorC = DEFAULTS.colorC;
        out.useC = !!out.useC;
        out.angle = Math.min(360, Math.max(0, Number(out.angle) || 0));
        if (!PATTERN_LABELS[out.pattern]) out.pattern = 'none';
        if (!(typeof out.image === 'string' && IMAGE_RE.test(out.image))) out.image = null;
        out.dim = Math.min(0.7, Math.max(0, Number(out.dim) || 0));
        out.blur = Math.min(12, Math.max(0, Number(out.blur) || 0));
        out.presetId = typeof out.presetId === 'string' ? out.presetId : null;
        return out;
    }

    // What you chose, or the vivid default if you have not chosen anything
    function load() {
        try {
            const raw = localStorage.getItem(storageKey());
            if (raw) return clean(JSON.parse(raw));
        } catch (e) { /* fall through to the default */ }
        return clean(Object.assign({}, PRESETS[0], { image: null, dim: 0, blur: 0, presetId: PRESETS[0].id }));
    }

    function save(s) {
        try { localStorage.setItem(storageKey(), JSON.stringify(s)); return true; }
        catch (e) { return false; }
    }

    function removeSaved() {
        try { localStorage.removeItem(storageKey()); } catch (e) { /* ignore */ }
    }

    // ---------- Drawing a wallpaper ----------

    function brightness(hex) {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    function isDark(s) {
        if (s.image) return s.dim >= 0.35;
        const values = [brightness(s.colorA), brightness(s.colorB)];
        if (s.useC) values.push(brightness(s.colorC));
        return values.reduce((a, b) => a + b, 0) / values.length < 0.55;
    }

    function gradientCss(s) {
        const stops = s.useC ? `${s.colorA}, ${s.colorC}, ${s.colorB}` : `${s.colorA}, ${s.colorB}`;
        return `linear-gradient(${s.angle}deg, ${stops})`;
    }

    function patternUri(name, dark) {
        const c = dark ? '%23ffffff' : '%230f172a';
        const o = dark ? '0.18' : '0.10';
        const shapes = {
            dots: `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><circle cx='5' cy='5' r='1.8' fill='${c}' fill-opacity='${o}'/><circle cx='20' cy='20' r='1.8' fill='${c}' fill-opacity='${o}'/></svg>`,
            grid: `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><path d='M36 0H0V36' fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='1'/></svg>`,
            lines: `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M-6 6L6 -6M0 24L24 0M18 30L30 18' stroke='${c}' stroke-opacity='${o}' stroke-width='1.4'/></svg>`,
            waves: `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='24'><path d='M0 12Q16 0 32 12T64 12' fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='1.6'/></svg>`,
            doodle: `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><g fill='none' stroke='${c}' stroke-opacity='${o}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M12 14l6 6m0-6l-6 6'/><circle cx='64' cy='20' r='5'/><path d='M20 62l6-10 6 10z'/><path d='M62 66h10m-5-5v10'/><path d='M44 42q4-6 8 0t8 0'/></g></svg>`
        };
        const svg = shapes[name];
        if (!svg) return '';
        // The colors above are already URL-encoded; encode the rest of the SVG text
        return 'data:image/svg+xml,' + svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'").replace(/\s+/g, ' ');
    }

    function renderLayer(el, s) {
        el.innerHTML = '';

        const base = document.createElement('div');
        base.className = 'wp-base';
        if (s.image) {
            base.style.backgroundImage = `url("${s.image}")`;
            if (s.blur) {
                base.style.filter = `blur(${s.blur}px)`;
                base.style.transform = 'scale(1.1)';
            }
        } else {
            base.style.background = gradientCss(s);
        }
        el.appendChild(base);

        // Soft light spots that give plain gradients some depth
        if (!s.image) {
            const glow = document.createElement('div');
            glow.className = 'wp-glow';
            el.appendChild(glow);
        }

        if (s.pattern && s.pattern !== 'none') {
            const uri = patternUri(s.pattern, isDark(s));
            if (uri) {
                const pattern = document.createElement('div');
                pattern.className = 'wp-pattern';
                pattern.style.backgroundImage = `url("${uri}")`;
                el.appendChild(pattern);
            }
        }

        if (s.dim > 0) {
            const dim = document.createElement('div');
            dim.className = 'wp-dim';
            dim.style.background = `rgba(0, 0, 0, ${s.dim})`;
            el.appendChild(dim);
        }
    }

    function applyWallpaper(s) {
        if (!layer) return;
        renderLayer(layer, s);
        layer.style.display = 'block';
        chatMain.classList.add('has-wallpaper');
    }

    // ---------- Photo ----------

    function fileToWallpaper(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read that file'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('That file is not a valid image'));
                img.onload = () => {
                    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    let quality = 0.78;
                    let url = canvas.toDataURL('image/jpeg', quality);
                    while (url.length > 1000000 && quality > 0.4) {
                        quality -= 0.1;
                        url = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(url);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ---------- Dialog ----------

    function injectDialog() {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal-backdrop" id="wp-modal">
                <div class="fx-card wp-card" role="dialog" aria-modal="true" aria-labelledby="wp-title">
                    <h3 id="wp-title">Chat wallpaper</h3>
                    <p class="fx-sub">Choose a ready-made background or create your own. Only you will see it.</p>

                    <div class="wp-preview" id="wp-preview">
                        <div class="wp-layer" id="wp-preview-layer"></div>
                        <div class="wp-bubble recv">Hey! How is it going?</div>
                        <div class="wp-bubble sent">Great, I love this wallpaper</div>
                    </div>

                    <span class="fx-label">Ready-made</span>
                    <div class="wp-swatches" id="wp-swatches"></div>

                    <span class="fx-label">Make your own</span>
                    <div class="wp-row">
                        <label class="wp-color">Color 1 <input type="color" id="wp-colorA"></label>
                        <label class="wp-color">Color 2 <input type="color" id="wp-colorB"></label>
                    </div>
                    <div class="wp-row" style="margin-top:0.6rem">
                        <label class="wp-color"><input type="checkbox" id="wp-useC"> Third color <input type="color" id="wp-colorC"></label>
                    </div>
                    <label class="wp-slider"><span>Direction</span>
                        <input type="range" id="wp-angle" min="0" max="360" step="5">
                        <output id="wp-angle-out"></output>
                    </label>
                    <div class="wp-chips" id="wp-patterns"></div>

                    <span class="fx-label">Your photo</span>
                    <div class="wp-row">
                        <button type="button" class="fx-btn ghost small" id="wp-upload">Choose a photo</button>
                        <button type="button" class="fx-btn ghost small" id="wp-remove-photo">Remove photo</button>
                    </div>
                    <input type="file" id="wp-file" accept="image/*" hidden>
                    <div class="wp-photo-controls" id="wp-photo-controls" hidden>
                        <label class="wp-slider"><span>Darken</span>
                            <input type="range" id="wp-dim" min="0" max="70" step="5">
                            <output id="wp-dim-out"></output>
                        </label>
                        <label class="wp-slider"><span>Blur</span>
                            <input type="range" id="wp-blur" min="0" max="12" step="1">
                            <output id="wp-blur-out"></output>
                        </label>
                    </div>
                    <p class="wp-note">Photos stay on this device and are never uploaded.</p>

                    <div class="fx-actions">
                        <button type="button" class="fx-btn ghost" id="wp-reset">Default</button>
                        <button type="button" class="fx-btn ghost" id="wp-cancel">Cancel</button>
                        <button type="button" class="fx-btn primary" id="wp-save">Save</button>
                    </div>
                </div>
            </div>
        `);

        // Ready-made swatches
        const swatches = $('wp-swatches');
        PRESETS.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wp-swatch';
            btn.dataset.id = p.id;
            btn.innerHTML = '<div class="wp-mini"></div><span></span>';
            btn.querySelector('span').textContent = p.name;
            renderLayer(btn.querySelector('.wp-mini'), clean(Object.assign({}, p, { image: null, dim: 0, blur: 0, presetId: p.id })));
            btn.addEventListener('click', () => choosePreset(p));
            swatches.appendChild(btn);
        });

        // Pattern chips
        const chips = $('wp-patterns');
        Object.keys(PATTERN_LABELS).forEach(key => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'wp-chip';
            chip.dataset.pattern = key;
            chip.textContent = PATTERN_LABELS[key];
            chip.addEventListener('click', () => { draft.pattern = key; edited(); });
            chips.appendChild(chip);
        });

        $('wp-colorA').addEventListener('input', (e) => { draft.colorA = e.target.value; draft.image = null; edited(); });
        $('wp-colorB').addEventListener('input', (e) => { draft.colorB = e.target.value; draft.image = null; edited(); });
        $('wp-colorC').addEventListener('input', (e) => { draft.colorC = e.target.value; draft.useC = true; draft.image = null; edited(); });
        $('wp-useC').addEventListener('change', (e) => { draft.useC = e.target.checked; draft.image = null; edited(); });
        $('wp-angle').addEventListener('input', (e) => { draft.angle = Number(e.target.value); edited(); });
        $('wp-dim').addEventListener('input', (e) => { draft.dim = Number(e.target.value) / 100; edited(); });
        $('wp-blur').addEventListener('input', (e) => { draft.blur = Number(e.target.value); edited(); });

        $('wp-upload').addEventListener('click', () => $('wp-file').click());
        $('wp-file').addEventListener('change', onPhotoChosen);
        $('wp-remove-photo').addEventListener('click', () => { draft.image = null; edited(); });

        $('wp-save').addEventListener('click', saveDraft);
        $('wp-cancel').addEventListener('click', closeDialog);
        $('wp-reset').addEventListener('click', resetWallpaper);
        $('wp-modal').addEventListener('click', (e) => { if (e.target === $('wp-modal')) closeDialog(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && $('wp-modal').classList.contains('open')) closeDialog();
        });
    }

    function openDialog() {
        draft = clean(load());
        syncControls();
        updatePreview();
        $('wp-modal').classList.add('open');
    }

    function closeDialog() {
        $('wp-modal').classList.remove('open');
        $('wp-file').value = '';
    }

    function syncControls() {
        $('wp-colorA').value = draft.colorA;
        $('wp-colorB').value = draft.colorB;
        $('wp-colorC').value = draft.colorC;
        $('wp-useC').checked = draft.useC;
        $('wp-angle').value = draft.angle;
        $('wp-angle-out').textContent = draft.angle + '\u00b0';
        $('wp-dim').value = Math.round(draft.dim * 100);
        $('wp-dim-out').textContent = Math.round(draft.dim * 100) + '%';
        $('wp-blur').value = draft.blur;
        $('wp-blur-out').textContent = draft.blur + 'px';
        $('wp-photo-controls').hidden = !draft.image;
        $('wp-remove-photo').style.display = draft.image ? '' : 'none';

        document.querySelectorAll('.wp-chip').forEach(c => c.classList.toggle('active', c.dataset.pattern === draft.pattern));
        document.querySelectorAll('.wp-swatch').forEach(s => s.classList.toggle('active', s.dataset.id === draft.presetId));
    }

    function updatePreview() {
        renderLayer($('wp-preview-layer'), draft);
    }

    // Called after any manual change
    function edited() {
        draft.presetId = null;
        syncControls();
        updatePreview();
    }

    function choosePreset(p) {
        draft = clean({
            colorA: p.colorA, colorB: p.colorB, colorC: p.colorC, useC: p.useC,
            angle: p.angle, pattern: p.pattern,
            image: null, dim: 0, blur: 0, presetId: p.id
        });
        syncControls();
        updatePreview();
    }

    async function onPhotoChosen(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            showNotification('Please choose an image file');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            showNotification('That image is too large (max 15 MB)');
            return;
        }

        try {
            draft.image = await fileToWallpaper(file);
            draft.dim = Math.max(draft.dim, 0.15);
            draft.pattern = 'none';
            edited();
        } catch (err) {
            console.error(err);
            showNotification(err.message);
        }
    }

    function saveDraft() {
        const s = clean(draft);
        if (!save(s)) {
            showNotification('Could not save this wallpaper. Try a smaller photo.');
            return;
        }
        applyWallpaper(s);
        closeDialog();
        showNotification('Wallpaper updated');
    }

    function resetWallpaper() {
        removeSaved();
        applyWallpaper(load());   // back to the vivid default
        closeDialog();
        showNotification('Wallpaper set to the default');
    }

    // ---------- Page setup ----------

    function addButtons() {
        const makeButton = () => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'wp-open';
            btn.title = 'Chat wallpaper';
            btn.setAttribute('aria-label', 'Chat wallpaper');
            btn.innerHTML = ICON_IMAGE;
            btn.addEventListener('click', openDialog);
            return btn;
        };

        // In the sidebar, next to Logout
        const info = document.querySelector('.sidebar .user-info');
        if (info) {
            const logoutBtn = info.querySelector('.btn-small');
            info.insertBefore(makeButton(), logoutBtn || null);
        }

        // In the top bar of a conversation on phones
        const bar = document.querySelector('.mobile-bar');
        if (bar) bar.appendChild(makeButton());
    }

    function init() {
        chatMain = document.querySelector('.chat-main');
        if (!chatMain) return;

        const style = document.createElement('style');
        style.id = 'wallpaper-style';
        style.textContent = STYLE;
        document.head.appendChild(style);

        layer = document.createElement('div');
        layer.id = 'wallpaper-layer';
        layer.style.display = 'none';
        chatMain.insertBefore(layer, chatMain.firstChild);

        injectDialog();
        addButtons();
        applyWallpaper(load());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();