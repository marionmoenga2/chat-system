/**
 * Authentication JavaScript
 * Handles login, registration, and token storage.
 * API_URL comes from config.js (must be loaded first).
 */

// ---------- Helpers ----------

function showError(message, type = 'error') {
    const errorDiv = document.getElementById('error-message');
    if (!errorDiv) {
        alert(message);
        return;
    }
    errorDiv.textContent = message;
    errorDiv.style.color = type === 'success' ? '#10b981' : '#ef4444';
}

function getField(id) {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Page error: element with id "${id}" was not found in the HTML`);
    }
    return el.value;
}

// Turn the server's "detail" (string, or array of validation errors) into readable text
function formatDetail(detail, fallback) {
    if (!detail) return fallback;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        return detail
            .map(d => {
                const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : '';
                return field ? `${field}: ${d.msg}` : d.msg;
            })
            .join('; ');
    }
    return fallback;
}

// Send a POST request and return { ok, status, data } or throw a clear Error
async function postJson(path, body) {
    if (typeof API_URL === 'undefined') {
        throw new Error('API_URL is not defined. Make sure js/config.js loads before js/auth.js');
    }

    const url = `${API_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000); // free Render plan can take ~60s to wake

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('The server took too long to respond. It may be waking up, please try again.');
        }
        console.error('Fetch failed:', { url, err });
        throw new Error(
            `Cannot reach the server at ${API_URL}. ` +
            'Possible causes: server is asleep or down, wrong URL, or CORS is blocking the request. ' +
            'Check the browser Console for details.'
        );
    } finally {
        clearTimeout(timer);
    }

    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (e) {
        console.error('Non-JSON response:', { url, status: response.status, body: text.slice(0, 300) });
        throw new Error(`Server returned an unexpected response (HTTP ${response.status}). Check the backend logs.`);
    }

    return { ok: response.ok, status: response.status, data };
}

function setBusy(form, busy) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = busy;
}

// Remove spaces, dashes and brackets; accept only international format like +254712345678
function cleanPhone(value) {
    const digits = String(value || '').replace(/[\s\-().]/g, '');
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

// ---------- UI ----------

function toggleForms() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    loginForm.classList.toggle('hidden');
    registerForm.classList.toggle('hidden');
    const err = document.getElementById('error-message');
    if (err) err.textContent = '';
}

// ---------- Login ----------

const loginFormEl = document.getElementById('loginForm');
if (loginFormEl) {
    loginFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        setBusy(loginFormEl, true);
        showError('Signing in...', 'success');

        try {
            const username = getField('login-username');
            const password = getField('login-password');

            const { ok, status, data } = await postJson('/api/auth/login', { username, password });

            if (ok && data && data.access_token) {
                localStorage.setItem('token', data.access_token);
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.href = 'chat.html';
            } else {
                console.error('Login rejected:', status, data);
                showError(formatDetail(data && data.detail, `Login failed (HTTP ${status})`));
            }
        } catch (error) {
            console.error('Login error:', error);
            showError(error.message);
        } finally {
            setBusy(loginFormEl, false);
        }
    });
} else {
    console.error('Form with id "loginForm" not found in the HTML');
}

// ---------- Registration ----------

const registerFormEl = document.getElementById('registerForm');
if (registerFormEl) {
    registerFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        setBusy(registerFormEl, true);
        showError('Creating account...', 'success');

        try {
            const username = getField('reg-username');
            const email = getField('reg-email');
            const password = getField('reg-password');
            const phone = cleanPhone(getField('reg-phone'));
            if (!phone) {
                showError('Enter your phone number with the country code, for example +254712345678.');
                return;
            }

            const { ok, status, data } = await postJson('/api/auth/signup', { username, email, password, phone });

            if (ok) {
                showError('Account created! Please log in.', 'success');
                toggleForms();
            } else {
                console.error('Registration rejected:', status, data);
                showError(formatDetail(data && data.detail, `Registration failed (HTTP ${status})`));
            }
        } catch (error) {
            console.error('Registration error:', error);
            showError(error.message);
        } finally {
            setBusy(registerFormEl, false);
        }
    });
} else {
    console.error('Form with id "registerForm" not found in the HTML');
}

// ---------- Redirect if already logged in ----------

const currentPath = window.location.pathname;
const params = new URLSearchParams(window.location.search);

// Visit index.html?logout=1 to wipe a stale session
if (params.get('logout') === '1') {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

if (localStorage.getItem('token') && localStorage.getItem('user') &&
    (currentPath === '/' || currentPath.endsWith('index.html'))) {
    window.location.href = 'chat.html';
}