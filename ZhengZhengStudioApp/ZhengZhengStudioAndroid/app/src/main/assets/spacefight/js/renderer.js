var RENDERER = {
    scene: null,
    camera: null,
    renderer: null,
    snapshot: null,
    meshes: {
        players: {},
        enemies: {},
        bullets: {},
        powerups: {}
    },
    materials: {},
    worldObjects: [],
    lastRenderAt: 0,

    init: function() {
        var canvas = document.getElementById('game-canvas');
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x05080d, 18, 72);

        this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 7, 14);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x05080d, 0);
        this.renderer.shadowMap.enabled = true;

        this.createMaterials();
        this.createWorld();
        window.addEventListener('resize', this.onResize.bind(this));
    },

    createMaterials: function() {
        this.materials.player = new THREE.MeshStandardMaterial({ color: 0xd5f3ef, emissive: 0x0b4d49, metalness: 0.35, roughness: 0.32 });
        this.materials.playerTrim = new THREE.MeshStandardMaterial({ color: 0x76d6dd, emissive: 0x12383c, metalness: 0.2, roughness: 0.25 });
        this.materials.remotePlayer = new THREE.MeshStandardMaterial({ color: 0x7ea6ff, emissive: 0x14264f, metalness: 0.35, roughness: 0.32 });
        this.materials.enemyScout = new THREE.MeshStandardMaterial({ color: 0xe6604f, emissive: 0x4a0e09, metalness: 0.2, roughness: 0.5 });
        this.materials.enemyFighter = new THREE.MeshStandardMaterial({ color: 0xf4b256, emissive: 0x4b2807, metalness: 0.22, roughness: 0.48 });
        this.materials.enemyBomber = new THREE.MeshStandardMaterial({ color: 0xa06ebf, emissive: 0x221134, metalness: 0.18, roughness: 0.55 });
        this.materials.playerBullet = new THREE.MeshBasicMaterial({ color: 0x9bf4f1 });
        this.materials.enemyBullet = new THREE.MeshBasicMaterial({ color: 0xff725f });
        this.materials.powerup = new THREE.MeshStandardMaterial({ color: 0x97d86d, emissive: 0x253f15, metalness: 0.15, roughness: 0.2 });
        this.materials.grid = new THREE.LineBasicMaterial({ color: 0x21394b, transparent: true, opacity: 0.32 });
        this.materials.asteroid = new THREE.MeshStandardMaterial({ color: 0x5c6570, emissive: 0x07090b, metalness: 0.05, roughness: 0.85 });
        this.materials.nebula = new THREE.MeshBasicMaterial({ color: 0x243142, transparent: true, opacity: 0.12, depthWrite: false });
    },

    createWorld: function() {
        var ambient = new THREE.AmbientLight(0x7085a8, 0.42);
        this.scene.add(ambient);

        var key = new THREE.DirectionalLight(0xffffff, 1.35);
        key.position.set(-10, 18, 12);
        key.castShadow = true;
        this.scene.add(key);

        var fill = new THREE.PointLight(0x76d6dd, 1.2, 45);
        fill.position.set(8, 5, -10);
        this.scene.add(fill);

        var grid = new THREE.GridHelper(70, 35, 0x46677c, 0x172938);
        grid.position.y = -0.04;
        this.scene.add(grid);

        var runway = new THREE.Mesh(
            new THREE.PlaneGeometry(14, 80),
            new THREE.MeshBasicMaterial({ color: 0x0b1117, transparent: true, opacity: 0.62, side: THREE.DoubleSide })
        );
        runway.rotation.x = -Math.PI / 2;
        runway.position.z = -6;
        this.scene.add(runway);

        var stars = new THREE.BufferGeometry();
        var positions = [];
        for (var i = 0; i < 1100; i++) {
            positions.push((Math.random() - 0.5) * 150, Math.random() * 55 + 4, (Math.random() - 0.5) * 160);
        }
        stars.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xc8d5df, size: 0.055 })));

        for (var a = 0; a < 34; a++) {
            var radius = Math.random() * 0.9 + 0.45;
            var asteroid = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), this.materials.asteroid);
            asteroid.position.set((Math.random() - 0.5) * 64, Math.random() * 7 + 0.5, Math.random() * -92 + 34);
            asteroid.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            asteroid.userData.spin = { x: Math.random() * 0.006, y: Math.random() * 0.008 };
            this.scene.add(asteroid);
            this.worldObjects.push(asteroid);
        }

        var nebula = new THREE.Mesh(new THREE.PlaneGeometry(85, 34), this.materials.nebula);
        nebula.position.set(0, 18, -62);
        nebula.rotation.x = -0.18;
        this.scene.add(nebula);
    },

    setSnapshot: function(snapshot) {
        this.snapshot = snapshot;
        this.syncCollection('players', snapshot.players || [], this.createPlayer.bind(this), this.updatePlayer.bind(this));
        this.syncCollection('enemies', snapshot.enemies || [], this.createEnemy.bind(this), this.updateEnemy.bind(this));
        this.syncCollection('bullets', snapshot.bullets || [], this.createBullet.bind(this), this.updateBullet.bind(this));
        this.syncCollection('powerups', snapshot.powerups || [], this.createPowerup.bind(this), this.updatePowerup.bind(this));
    },

    syncCollection: function(kind, list, createFn, updateFn) {
        var bucket = this.meshes[kind];
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            var entity = list[i];
            seen[entity.id] = true;
            if (!bucket[entity.id]) bucket[entity.id] = createFn(entity);
            updateFn(bucket[entity.id], entity);
        }

        Object.keys(bucket).forEach(function(id) {
            if (!seen[id]) {
                RENDERER.scene.remove(bucket[id]);
                delete bucket[id];
            }
        });
    },

    createPlayer: function(player) {
        var group = new THREE.Group();
        var bodyMaterial = player.id === NETWORK.playerId ? this.materials.player : this.materials.remotePlayer;

        var body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 4), bodyMaterial);
        body.rotation.x = -Math.PI / 2;
        body.castShadow = true;
        group.add(body);

        var wings = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.55), bodyMaterial);
        wings.position.z = 0.24;
        wings.castShadow = true;
        group.add(wings);

        var canopy = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.48), this.materials.playerTrim);
        canopy.position.set(0, 0.18, -0.28);
        group.add(canopy);

        var engineLeft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.46), this.materials.playerTrim);
        var engineRight = engineLeft.clone();
        engineLeft.position.set(-0.55, -0.02, 0.64);
        engineRight.position.set(0.55, -0.02, 0.64);
        group.add(engineLeft);
        group.add(engineRight);

        this.scene.add(group);
        return group;
    },

    updatePlayer: function(mesh, player) {
        mesh.position.set(player.position.x, 0.7, player.position.z);
        mesh.rotation.y = player.rotation;
        mesh.visible = player.health > 0;
    },

    createEnemy: function(enemy) {
        var material = enemy.type === 'bomber' ? this.materials.enemyBomber : (enemy.type === 'fighter' ? this.materials.enemyFighter : this.materials.enemyScout);
        var scale = enemy.type === 'bomber' ? 1.35 : (enemy.type === 'fighter' ? 1.08 : 0.86);
        var group = new THREE.Group();
        var hull = new THREE.Mesh(new THREE.OctahedronGeometry(0.82, 0), material);
        hull.scale.set(scale, scale * 0.7, scale * 1.35);
        hull.castShadow = true;
        group.add(hull);

        var fin = new THREE.Mesh(new THREE.BoxGeometry(scale * 1.6, 0.08, scale * 0.38), material);
        fin.position.z = 0.25 * scale;
        group.add(fin);

        var core = new THREE.Mesh(new THREE.SphereGeometry(0.18 * scale, 10, 8), this.materials.enemyBullet);
        core.position.z = -0.45 * scale;
        group.add(core);

        this.scene.add(group);
        return group;
    },

    updateEnemy: function(mesh, enemy) {
        mesh.position.set(enemy.position.x, 0.9, enemy.position.z);
        mesh.rotation.y = Math.PI + Math.sin(Date.now() * 0.001 + enemy.position.x) * 0.12;
        mesh.rotation.x = Math.sin(Date.now() * 0.0015 + enemy.position.z) * 0.08;
    },

    createBullet: function(bullet) {
        var material = bullet.owner === 'enemy' ? this.materials.enemyBullet : this.materials.playerBullet;
        var group = new THREE.Group();
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(bullet.owner === 'enemy' ? 0.2 : 0.15, 12, 8), material);
        var trail = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.12, bullet.owner === 'enemy' ? 1.3 : 1.7, 8),
            new THREE.MeshBasicMaterial({ color: bullet.owner === 'enemy' ? 0xff725f : 0x76d6dd, transparent: true, opacity: 0.34 })
        );
        trail.rotation.x = Math.PI / 2;
        trail.position.z = bullet.owner === 'enemy' ? 0.35 : 0.55;
        group.add(mesh);
        group.add(trail);
        this.scene.add(group);
        return group;
    },

    updateBullet: function(mesh, bullet) {
        mesh.position.set(bullet.position.x, 0.68, bullet.position.z);
        if (bullet.velocity) {
            mesh.rotation.y = Math.atan2(bullet.velocity.x, bullet.velocity.z);
        }
    },

    createPowerup: function() {
        var mesh = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.12, 8, 16), this.materials.powerup);
        this.scene.add(mesh);
        return mesh;
    },

    updatePowerup: function(mesh, powerup) {
        mesh.position.set(powerup.position.x, 0.75 + Math.sin(Date.now() * 0.006) * 0.14, powerup.position.z);
        mesh.rotation.y += 0.04;
    },

    render: function() {
        if (!this.renderer || !this.scene || !this.camera) return;
        var player = GAME.player;
        for (var i = 0; i < this.worldObjects.length; i++) {
            var object = this.worldObjects[i];
            object.rotation.x += object.userData.spin.x;
            object.rotation.y += object.userData.spin.y;
            if (player && object.position.z > player.position.z + 28) {
                object.position.z -= 95;
                object.position.x = (Math.random() - 0.5) * 64;
            }
        }
        if (player) {
            var forwardX = Math.sin(player.rotation);
            var forwardZ = -Math.cos(player.rotation);
            var desiredX = player.position.x - forwardX * 7;
            var desiredY = 5.4;
            var desiredZ = player.position.z - forwardZ * 10;
            this.camera.position.x += (desiredX - this.camera.position.x) * 0.08;
            this.camera.position.y += (desiredY - this.camera.position.y) * 0.08;
            this.camera.position.z += (desiredZ - this.camera.position.z) * 0.08;
            this.camera.lookAt(player.position.x + forwardX * 8, 0.65, player.position.z + forwardZ * 8);
        }
        this.renderer.render(this.scene, this.camera);
    },

    clearDynamic: function() {
        ['players', 'enemies', 'bullets', 'powerups'].forEach(function(kind) {
            var bucket = RENDERER.meshes[kind];
            Object.keys(bucket).forEach(function(id) {
                RENDERER.scene.remove(bucket[id]);
                delete bucket[id];
            });
        });
    },

    onResize: function() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
};
