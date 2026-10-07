// Backend address for the admin panel.
// Uses your local server on your own machine and the live backend when deployed.
const API_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : 'https://chat-system-api.onrender.com';
