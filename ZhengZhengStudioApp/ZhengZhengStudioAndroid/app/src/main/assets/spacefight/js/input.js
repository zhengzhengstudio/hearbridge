var INPUT = {
    keys: {},
    mouse: {
        left: false,
        locked: false,
        dx: 0,
        dy: 0
    },
    wheelWeaponDelta: 0,
    gamepad: null,
    gamepadDeadzone: 0.2,

    init: function() {
        var canvas = document.getElementById('game-canvas');
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        document.addEventListener('keyup', this.onKeyUp.bind(this));
        canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: true });
        canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });
        canvas.addEventListener('click', this.requestPointerLock.bind(this));
        document.addEventListener('pointerlockchange', this.onPointerLockChange.bind(this));
        window.addEventListener('gamepadconnected', this.onGamepadConnected.bind(this));
        window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected.bind(this));
    },

    onKeyDown: function(e) {
        this.keys[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) !== -1) {
            e.preventDefault();
        }
    },

    onKeyUp: function(e) {
        this.keys[e.code] = false;
    },

    onMouseDown: function(e) {
        if (e.button === 0) this.mouse.left = true;
    },

    onMouseUp: function(e) {
        if (e.button === 0) this.mouse.left = false;
    },

    onMouseMove: function(e) {
        if (!this.mouse.locked) return;
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
    },

    onWheel: function(e) {
        this.wheelWeaponDelta += e.deltaY > 0 ? 1 : -1;
    },

    requestPointerLock: function() {
        if (GAME.state !== 'playing') return;
        var canvas = document.getElementById('game-canvas');
        if (document.pointerLockElement === canvas) return;
        var lock = canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock;
        if (lock) lock.call(canvas);
    },

    onPointerLockChange: function() {
        this.mouse.locked = document.pointerLockElement === document.getElementById('game-canvas');
    },

    onGamepadConnected: function(e) {
        this.gamepad = e.gamepad;
    },

    onGamepadDisconnected: function() {
        this.gamepad = null;
    },

    updateGamepad: function(frame) {
        var pads = navigator.getGamepads ? navigator.getGamepads() : [];
        this.gamepad = this.gamepad || pads[0] || null;
        if (!this.gamepad) return frame;

        var pad = pads[this.gamepad.index] || this.gamepad;
        var axes = pad.axes || [];
        var buttons = pad.buttons || [];
        var leftY = Math.abs(axes[1] || 0) > this.gamepadDeadzone ? axes[1] : 0;
        var leftX = Math.abs(axes[0] || 0) > this.gamepadDeadzone ? axes[0] : 0;
        var rightX = Math.abs(axes[2] || 0) > this.gamepadDeadzone ? axes[2] : 0;

        frame.throttle = Math.max(frame.throttle, -leftY);
        frame.strafe = leftX;
        frame.turn += rightX * 8;
        frame.fire = frame.fire || Boolean(buttons[0] && buttons[0].pressed);
        frame.boost = frame.boost || Boolean(buttons[7] && buttons[7].pressed);
        if (buttons[12] && buttons[12].pressed) frame.weapon = 0;
        if (buttons[13] && buttons[13].pressed) frame.weapon = 1;
        if (buttons[14] && buttons[14].pressed) frame.weapon = 2;

        return frame;
    },

    getFrame: function() {
        var forward = this.keys.KeyW || this.keys.ArrowUp ? 1 : 0;
        var backward = this.keys.KeyS || this.keys.ArrowDown ? 1 : 0;
        var left = this.keys.KeyA || this.keys.ArrowLeft ? 1 : 0;
        var right = this.keys.KeyD || this.keys.ArrowRight ? 1 : 0;
        var weapon = null;

        if (this.keys.Digit1) weapon = 0;
        if (this.keys.Digit2) weapon = 1;
        if (this.keys.Digit3) weapon = 2;
        if (this.wheelWeaponDelta !== 0 && GAME.player) {
            var next = GAME.player.currentWeapon + (this.wheelWeaponDelta > 0 ? 1 : -1);
            weapon = (next + 3) % 3;
            this.wheelWeaponDelta = 0;
        }

        var frame = {
            throttle: forward - backward,
            strafe: right - left,
            turn: this.mouse.dx * 0.08,
            boost: Boolean(this.keys.Space),
            fire: this.mouse.left,
            weapon: weapon
        };

        this.mouse.dx = 0;
        this.mouse.dy = 0;
        return this.updateGamepad(frame);
    },

    reset: function() {
        this.keys = {};
        this.mouse.left = false;
        this.mouse.dx = 0;
        this.mouse.dy = 0;
        this.wheelWeaponDelta = 0;
    }
};

INPUT.init();
