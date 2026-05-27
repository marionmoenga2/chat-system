// Auto-detect environment
const IS_LOCAL = window.location.hostname === 'localhost' 
    || window.location.hostname === '127.0.0.1';

const API_URL = IS_LOCAL 
    ? 'http://localhost:8000' 
    : 'https://chat-api.onrender.com';

const WS_URL = IS_LOCAL
    ? 'ws://localhost:8000'
    : 'wss://chat-api.onrender.com';
