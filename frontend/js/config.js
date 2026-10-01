// Auto-detect environment
const IS_LOCAL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

const PROD_HOST = 'chat-system-api.onrender.com';

const API_URL = IS_LOCAL
  ? 'http://localhost:8000'
  : `https://${PROD_HOST}`;

const WS_URL = IS_LOCAL
  ? 'ws://localhost:8000'
  : `wss://${PROD_HOST}`;