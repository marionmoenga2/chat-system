const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = IS_LOCAL ? "http://localhost:8000" : "https://chat-api.onrender.com";
