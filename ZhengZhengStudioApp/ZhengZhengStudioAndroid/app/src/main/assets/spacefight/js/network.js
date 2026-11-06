var NETWORK = {
    socket: null,
    connected: false,
    connecting: false,
    roomId: null,
    playerId: null,
    lastSnapshot: null,
    latency: 0,
    pendingPings: {},
    inputTimer: null,
    reconnectTimer: null,
    mode: 'solo',
    url: null,

    connect: function(mode) {
        this.mode = mode || 'solo';
        this.disconnect(false);
        this.connecting = true;
        this.setStatus('连接中');

        var protocol = window.location.protocol === 'http:' ? 'ws:' : 'wss:';
        var host = window.SPACEFIGHT_WS_HOST || window.location.host || 'spacefight.zhengzhengstudio.cn';
        this.url = protocol + '//' + host + '/ws';

        try {
            this.socket = new WebSocket(this.url);
        } catch (err) {
            this.connecting = false;
            this.setStatus('连接失败');
            GAME.showNetworkError('无法创建 WebSocket 连接');
            return;
        }

        this.socket.addEventListener('open', this.onOpen.bind(this));
        this.socket.addEventListener('message', this.onMessage.bind(this));
        this.socket.addEventListener('close', this.onClose.bind(this));
        this.socket.addEventListener('error', this.onError.bind(this));
    },

    onOpen: function() {
        this.connected = true;
        this.connecting = false;
        this.send({
            type: 'join',
            mode: this.mode,
            difficulty: GAME.difficulty,
            name: this.playerName()
        });
        this.startInputPump();
        this.setStatus('已连接');
    },

    playerName: function() {
        try {
            var raw = localStorage.getItem('zz_passport_user') || localStorage.getItem('spacefight_user');
            var user = raw ? JSON.parse(raw) : null;
            return user && (user.nickname || user.username || user.displayName || user.uid) || 'Player';
        } catch (err) {
            return 'Player';
        }
    },

    onMessage: function(event) {
        var message;
        try {
            message = JSON.parse(event.data);
        } catch (err) {
            return;
        }

        if (message.type === 'welcome') {
            this.playerId = message.playerId;
            this.roomId = message.roomId;
            GAME.onServerReady(message);
            return;
        }

        if (message.type === 'snapshot') {
            this.lastSnapshot = message;
            GAME.applySnapshot(message);
            RENDERER.setSnapshot(message);
            return;
        }

        if (message.type === 'pong') {
            var sentAt = this.pendingPings[message.id];
            if (sentAt) {
                this.latency = Math.round(performance.now() - sentAt);
                delete this.pendingPings[message.id];
                GAME.updateConnectionHud();
            }
            return;
        }

        if (message.type === 'error') {
            GAME.showNetworkError(message.message || '服务器返回错误');
        }
    },

    onClose: function() {
        var wasPlaying = GAME.state === 'playing';
        this.connected = false;
        this.connecting = false;
        this.stopInputPump();
        this.setStatus('已断开');

        if (wasPlaying) {
            GAME.showNetworkError('连接断开，游戏已暂停');
        }
    },

    onError: function() {
        this.setStatus('连接异常');
    },

    startInputPump: function() {
        this.stopInputPump();
        this.inputTimer = setInterval(function() {
            NETWORK.sendInput();
            NETWORK.ping();
        }, 1000 / 30);
    },

    stopInputPump: function() {
        if (this.inputTimer) {
            clearInterval(this.inputTimer);
            this.inputTimer = null;
        }
    },

    sendInput: function() {
        if (!this.connected || GAME.state !== 'playing') return;
        this.send({
            type: 'input',
            input: INPUT.getFrame()
        });
    },

    ping: function() {
        if (!this.connected) return;
        var now = performance.now();
        if (this.lastPingAt && now - this.lastPingAt < 1000) return;
        this.lastPingAt = now;
        var id = String(Date.now()) + Math.random().toString(16).slice(2);
        this.pendingPings[id] = now;
        this.send({ type: 'ping', id: id });
    },

    send: function(data) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify(data));
    },

    setStatus: function(status) {
        var el = document.getElementById('network-status');
        if (el) el.textContent = status;
    },

    disconnect: function(notifyServer) {
        this.stopInputPump();
        if (this.socket) {
            if (notifyServer !== false) this.send({ type: 'leave' });
            this.socket.close();
        }
        this.socket = null;
        this.connected = false;
        this.connecting = false;
        this.roomId = null;
        this.playerId = null;
        this.lastSnapshot = null;
    }
};
