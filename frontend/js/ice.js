/* Fetches the call relay (TURN) settings from the server. Loads before calls.js. */
(function () {
    var token = localStorage.getItem('token');
    if (!token || typeof API_URL === 'undefined') return;
    fetch(API_URL + '/api/calls/ice', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && Array.isArray(d.iceServers)) window.CHATWAVE_ICE_SERVERS = d.iceServers; })
        .catch(function () { /* calls still work with the built-in STUN servers */ });
})();
