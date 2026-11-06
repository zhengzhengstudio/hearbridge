document.addEventListener('visibilitychange', function() {
    if (document.hidden && NETWORK.connected) {
        NETWORK.send({ type: 'input', input: { throttle: 0, strafe: 0, turn: 0, boost: false, fire: false, weapon: null } });
    }
});
