var PLAYER = {
    id: null,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    health: 100,
    shield: 100,
    energy: 100,
    score: 0,
    currentWeapon: 0,
    weapons: [
        { name: 'laser', ammo: 100, maxAmmo: 100 },
        { name: 'missile', ammo: 20, maxAmmo: 20 },
        { name: 'plasma', ammo: 100, maxAmmo: 100 }
    ]
};

var GAME = {
    state: 'loading',
    difficulty: 'normal',
    volume: 0.7,
    language: 'zh-CN',
    player: null,
    room: null,
    lastSnapshotAt: 0,
    renderHandle: null,

    init: function() {
        this.loadSettings();
        this.loadAssets();
        this.setupEventListeners();
        this.startLoading();
        this.startRenderLoop();
    },

    loadAssets: function() {
        ASSETS.load();
    },

    loadSettings: function() {
        try {
            var saved = JSON.parse(localStorage.getItem('spacefight-settings') || '{}');
            this.difficulty = saved.difficulty || this.difficulty;
            this.volume = typeof saved.volume === 'number' ? saved.volume : this.volume;
            this.language = saved.language || this.language;
        } catch (err) {}
    },

    startLoading: function() {
        var progress = 0;
        var loadingInterval = setInterval(function() {
            progress += 18;
            if (progress >= 100) {
                progress = 100;
                clearInterval(loadingInterval);
                GAME.showMenu();
            }
            document.querySelector('.loading-progress').style.width = progress + '%';
        }, 120);
    },

    setupEventListeners: function() {
        document.getElementById('btn-play').addEventListener('click', function() {
            GAME.startGame('solo');
        });

        document.getElementById('btn-multiplayer').addEventListener('click', function() {
            GAME.startGame('public');
        });

        document.getElementById('btn-settings').addEventListener('click', function() {
            GAME.showSettings();
        });

        document.getElementById('btn-mods').addEventListener('click', function() {
            GAME.showMods();
        });

        document.getElementById('btn-quit').addEventListener('click', function() {
            GAME.showMenu();
        });

        document.getElementById('btn-restart').addEventListener('click', function() {
            GAME.startGame(NETWORK.mode || 'solo');
        });

        document.getElementById('btn-menu').addEventListener('click', function() {
            NETWORK.disconnect();
            GAME.showMenu();
        });

        document.getElementById('btn-save-settings').addEventListener('click', function() {
            GAME.saveSettings();
        });

        document.getElementById('btn-close-settings').addEventListener('click', function() {
            GAME.hideSettings();
        });

        document.getElementById('difficulty-select').value = this.difficulty;
        document.getElementById('volume-slider').value = Math.round(this.volume * 100);
        document.getElementById('language-select').value = this.language;
    },

    showMenu: function() {
        this.state = 'menu';
        this.player = null;
        this.room = null;
        INPUT.reset();
        RENDERER.clearDynamic();
        this.hideAllScreens();
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('menu-screen').classList.remove('hidden');
        this.updateConnectionHud();
    },

    startGame: function(mode) {
        this.state = 'connecting';
        this.hideAllScreens();
        document.getElementById('hud').classList.remove('hidden');
        this.resetHud();
        NETWORK.connect(mode);
    },

    onServerReady: function() {
        this.state = 'playing';
        this.hideAllScreens();
        document.getElementById('hud').classList.remove('hidden');
        this.updateConnectionHud();
    },

    applySnapshot: function(snapshot) {
        this.lastSnapshotAt = performance.now();
        this.room = snapshot.room;
        this.player = (snapshot.players || []).find(function(player) {
            return player.id === NETWORK.playerId;
        }) || snapshot.players[0] || null;

        if (this.player) {
            Object.assign(PLAYER, this.player);
        }

        this.updateHUD(snapshot);

        if (this.player && this.player.health <= 0 && this.state === 'playing') {
            this.gameOver(this.player.score || 0);
        }
    },

    updateHUD: function(snapshot) {
        var player = this.player || PLAYER;
        document.getElementById('health-fill').style.width = this.toPercent(player.health, 100);
        document.getElementById('shield-fill').style.width = this.toPercent(player.shield, 100);
        document.getElementById('energy-fill').style.width = this.toPercent(player.energy, 100);
        document.getElementById('health-value').textContent = Math.round(player.health || 0);
        document.getElementById('shield-value').textContent = Math.round(player.shield || 0);
        document.getElementById('energy-value').textContent = Math.round(player.energy || 0);
        document.getElementById('score-display').textContent = Math.floor(player.score || 0);

        var room = snapshot ? snapshot.room : this.room;
        document.getElementById('wave-display').textContent = room ? room.wave : '-';
        document.getElementById('room-display').textContent = NETWORK.roomId || '-';
        document.getElementById('players-display').textContent = snapshot ? snapshot.players.length : 0;
        this.updateWeaponHud(player);
        this.updateConnectionHud();
    },

    updateWeaponHud: function(player) {
        var items = document.querySelectorAll('.weapon-item');
        items.forEach(function(item) {
            var index = Number(item.getAttribute('data-weapon'));
            var weapon = player.weapons && player.weapons[index];
            item.classList.toggle('active', index === player.currentWeapon);
            var ammo = item.querySelector('.weapon-ammo');
            if (!ammo || !weapon) return;
            ammo.textContent = index === 2 ? Math.round(player.energy) + '%' : weapon.ammo + '/' + weapon.maxAmmo;
        });
    },

    updateConnectionHud: function() {
        var latency = document.getElementById('latency-display');
        if (latency) latency.textContent = NETWORK.connected ? NETWORK.latency + 'ms' : '-';
    },

    resetHud: function() {
        document.getElementById('health-fill').style.width = '100%';
        document.getElementById('shield-fill').style.width = '100%';
        document.getElementById('energy-fill').style.width = '100%';
        document.getElementById('health-value').textContent = '100';
        document.getElementById('shield-value').textContent = '100';
        document.getElementById('energy-value').textContent = '100';
        document.getElementById('score-display').textContent = '0';
        document.getElementById('wave-display').textContent = '-';
        document.getElementById('room-display').textContent = '-';
        document.getElementById('players-display').textContent = '0';
        document.getElementById('network-status').textContent = '连接中';
    },

    toPercent: function(value, max) {
        var pct = Math.max(0, Math.min(100, (value / max) * 100));
        return pct + '%';
    },

    showSettings: function() {
        document.getElementById('settings-screen').classList.remove('hidden');
        document.getElementById('menu-screen').classList.add('hidden');
    },

    hideSettings: function() {
        document.getElementById('settings-screen').classList.add('hidden');
        document.getElementById('menu-screen').classList.remove('hidden');
    },

    showMods: function() {
        MODS.show();
    },

    saveSettings: function() {
        this.volume = document.getElementById('volume-slider').value / 100;
        this.difficulty = document.getElementById('difficulty-select').value;
        this.language = document.getElementById('language-select').value;
        localStorage.setItem('spacefight-settings', JSON.stringify({
            volume: this.volume,
            difficulty: this.difficulty,
            language: this.language
        }));
        if (window.I18N) I18N.setLanguage(this.language);
        this.hideSettings();
    },

    hideAllScreens: function() {
        document.querySelectorAll('.screen').forEach(function(screen) {
            screen.classList.add('hidden');
        });
    },

    showNetworkError: function(message) {
        var el = document.getElementById('network-message');
        if (el) {
            el.textContent = message;
            el.classList.remove('hidden');
            clearTimeout(this.networkMessageTimer);
            this.networkMessageTimer = setTimeout(function() {
                el.classList.add('hidden');
            }, 3500);
        }
    },

    gameOver: function(score) {
        this.state = 'gameover';
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('final-score').textContent = Math.floor(score || 0);
    },

    startRenderLoop: function() {
        if (this.renderHandle) cancelAnimationFrame(this.renderHandle);
        var loop = function() {
            RENDERER.render();
            GAME.renderHandle = requestAnimationFrame(loop);
        };
        this.renderHandle = requestAnimationFrame(loop);
    }
};

var GAMELOOP = {
    start: function() {},
    stop: function() {}
};

document.addEventListener('DOMContentLoaded', function() {
    RENDERER.init();
    GAME.init();
});
