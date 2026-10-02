/**
 * API helpers: authenticated requests to the backend.
 * API_URL comes from config.js (must be loaded first).
 */

function getHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

// Shared request logic: returns parsed JSON, or null on failure
async function apiRequest(method, endpoint, data) {
    try {
        const options = { method, headers: getHeaders() };
        if (data !== undefined) options.body = JSON.stringify(data);

        const response = await fetch(`${API_URL}${endpoint}`, options);

        if (response.status === 401) {
            logout();
            return null;
        }
        if (!response.ok) {
            console.error(`${method} ${endpoint} failed:`, response.status);
            return null;
        }
        if (response.status === 204) return {};
        return await response.json();
    } catch (error) {
        console.error(`${method} ${endpoint} network error:`, error);
        return null;
    }
}

const apiGet = (endpoint) => apiRequest('GET', endpoint);
const apiPost = (endpoint, data) => apiRequest('POST', endpoint, data);
const apiPut = (endpoint, data) => apiRequest('PUT', endpoint, data);
const apiDelete = (endpoint) => apiRequest('DELETE', endpoint);

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}