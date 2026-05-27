/**
 * API Utility Functions
 * Centralized fetch wrapper with authentication headers.
 */

const API_BASE = 'http://localhost:8000';

// Get auth headers
function getHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// Authenticated GET request
async function apiGet(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'GET',
        headers: getHeaders()
    });
    if (response.status === 401) {
        logout();
        return null;
    }
    return response.json();
}

// Authenticated POST request
async function apiPost(endpoint, data) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    if (response.status === 401) {
        logout();
        return null;
    }
    return response.json();
}

// Logout function
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}