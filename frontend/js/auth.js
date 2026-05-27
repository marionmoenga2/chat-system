/**
 * Authentication JavaScript
 * Handles login, registration, and token storage.
 */

const API_URL = 'http://localhost:8000';

// Toggle between login and register forms
function toggleForms() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    loginForm.classList.toggle('hidden');
    registerForm.classList.toggle('hidden');
    document.getElementById('error-message').textContent = '';
}

// Handle Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Store token and user info
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('user', JSON.stringify(data.user));
            window.location.href = 'chat.html';
        } else {
            showError(data.detail || 'Login failed');
        }
    } catch (error) {
        showError('Network error. Please try again.');
    }
});

// Handle Registration
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    
    try {
        const response = await fetch(`${API_URL}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showError('Account created! Please login.', 'success');
            toggleForms();
        } else {
            showError(data.detail || 'Registration failed');
        }
    } catch (error) {
        showError('Network error. Please try again.');
    }
});

function showError(message, type = 'error') {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.color = type === 'success' ? '#10b981' : '#ef4444';
}

// Check if already logged in
if (localStorage.getItem('token') && window.location.pathname.includes('index')) {
    window.location.href = 'chat.html';
}