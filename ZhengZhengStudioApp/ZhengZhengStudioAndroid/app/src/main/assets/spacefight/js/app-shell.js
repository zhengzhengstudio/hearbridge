var SPACEFIGHT_APP = (function() {
    var VERSION = '0.3.0';
    var BUILD = 5;
    var MANIFEST_URL = 'https://zhengzhengstudio.cn/api/apps/manifest.json';
    var DOWNLOADS_URL = 'https://zhengzhengstudio.cn/downloads.html?search=SpaceFight';

    function ready(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    function parsePassportReturn() {
        var params = new URLSearchParams(window.location.search);
        var token = params.get('token') || params.get('access_token') || params.get('passport_token');
        var raw = params.get('user') || params.get('passport_user') || params.get('account');
        var uid = params.get('uid') || params.get('passport_uid') || params.get('user_id');
        var user = null;
        if (raw) {
            try {
                user = JSON.parse(decodeURIComponent(raw));
            } catch (err) {
                user = null;
            }
        }
        if (!user && uid) {
            user = {
                uid: uid,
                username: params.get('username') || params.get('nickname') || '通行证用户'
            };
        }
        if (user) {
            if (token) user.token = token;
            localStorage.setItem('zz_passport_user', JSON.stringify(user));
            if (token) localStorage.setItem('zz_passport_token', token);
            history.replaceState(null, '', window.location.pathname);
        }
    }

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem('zz_passport_user') || localStorage.getItem('spacefight_user') || 'null');
        } catch (err) {
            return null;
        }
    }

    function loginUrl() {
        var redirect = 'https://spacefight.zhengzhengstudio.cn/?appReturn=1';
        if (location.protocol !== 'file:') {
            redirect = location.origin + location.pathname;
        }
        return 'https://zhengzhengstudio.cn/passport/login.html?redirect=' + encodeURIComponent(redirect) + '&from=spacefight&scope=spacefight&returnUser=1';
    }

    function absolute(url) {
        if (!url) return '';
        if (/^https?:\/\//.test(url)) return url;
        return 'https://zhengzhengstudio.cn' + url;
    }

    function renderShell() {
        if (document.getElementById('spacefight-appbar')) return;
        var bar = document.createElement('div');
        bar.id = 'spacefight-appbar';
        bar.innerHTML = [
            '<button type="button" data-action="profile">我的</button>',
            '<button type="button" data-action="login">通行证登录</button>',
            '<button type="button" data-action="downloads">下载中心</button>',
            '<button type="button" data-action="update">检查更新</button>'
        ].join('');
        document.body.appendChild(bar);

        var panel = document.createElement('div');
        panel.id = 'spacefight-profile-panel';
        panel.className = 'hidden';
        document.body.appendChild(panel);

        bar.addEventListener('click', function(event) {
            var action = event.target && event.target.getAttribute('data-action');
            if (!action) return;
            if (action === 'login') window.location.href = loginUrl();
            if (action === 'downloads') window.location.href = DOWNLOADS_URL;
            if (action === 'profile') showProfile();
            if (action === 'update') checkUpdates(true);
        });
    }

    function showProfile() {
        var user = getUser();
        var panel = document.getElementById('spacefight-profile-panel');
        panel.classList.toggle('hidden');
        panel.innerHTML = [
            '<div class="profile-card">',
            '<h2>我的 SpaceFight</h2>',
            '<p>' + (user ? '通行证：' + escapeHtml(user.nickname || user.username || user.uid || '已登录') : '未登录铮铮通行证') + '</p>',
            '<p>当前版本 v' + VERSION + ' build ' + BUILD + '</p>',
            '<div class="profile-actions">',
            '<a href="' + loginUrl() + '">通行证登录</a>',
            '<a href="' + DOWNLOADS_URL + '">下载安装包</a>',
            '<button type="button" id="spacefight-profile-update">检查更新</button>',
            '</div>',
            '</div>'
        ].join('');
        var update = document.getElementById('spacefight-profile-update');
        if (update) update.addEventListener('click', function() { checkUpdates(true); });
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function(ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function platform() {
        var ua = navigator.userAgent.toLowerCase();
        if (ua.indexOf('spacefightharmony') >= 0) return 'harmonyos';
        if (ua.indexOf('android') >= 0) return 'android';
        if (ua.indexOf('iphone') >= 0 || ua.indexOf('ipad') >= 0) return 'ios';
        if (ua.indexOf('mac') >= 0) return 'macos';
        return 'web';
    }

    function checkUpdates(manual) {
        fetch(MANIFEST_URL, { cache: 'no-store' })
            .then(function(res) { return res.json(); })
            .then(function(manifest) {
                var apps = manifest.apps || [];
                var currentPlatform = platform();
                var app = apps.find(function(item) {
                    return item.id === 'spacefight-' + currentPlatform;
                }) || apps.find(function(item) {
                    return /^spacefight-/.test(item.id || '');
                });
                if (!app) {
                    if (manual) alert('下载中心暂未发布 SpaceFight 安装包');
                    return;
                }
                var newer = Number(app.build || 0) > BUILD || compareVersion(app.version, VERSION) > 0;
                if (!newer) {
                    if (manual) alert('当前已是最新版本');
                    return;
                }
                if (confirm('发现新版本 ' + app.version + '，现在下载吗？')) {
                    window.location.href = absolute(app.downloadURL || app.url || app.versionedUrl);
                }
            })
            .catch(function() {
                if (manual) alert('暂时无法读取更新清单');
            });
    }

    function compareVersion(a, b) {
        var pa = String(a || '0').split('.').map(Number);
        var pb = String(b || '0').split('.').map(Number);
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var da = pa[i] || 0;
            var db = pb[i] || 0;
            if (da > db) return 1;
            if (da < db) return -1;
        }
        return 0;
    }

    ready(function() {
        parsePassportReturn();
        renderShell();
        checkUpdates(false);
    });

    return {
        version: VERSION,
        build: BUILD,
        checkUpdates: checkUpdates
    };
})();
