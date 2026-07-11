// 全局认证与 API 请求工具
(function (global) {
    const TOKEN_KEY = 'hear_token';

    function getToken() {
        try {
            return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function setToken(token) {
        try {
            localStorage.setItem(TOKEN_KEY, token);
        } catch (e) {
            sessionStorage.setItem(TOKEN_KEY, token);
        }
    }

    function clearToken() {
        try {
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(TOKEN_KEY);
        } catch (e) {
            // ignore
        }
    }

    function isLoggedIn() {
        const token = getToken();
        if (!token) return false;
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            return payload && typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
        } catch (e) {
            return false;
        }
    }

    async function apiFetch(url, options = {}) {
        const token = getToken();
        const headers = { ...options.headers };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
            headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(url, { ...options, headers });
        if (res.status === 401) {
            clearToken();
            const err = new Error('login_required');
            err.status = 401;
            throw err;
        }
        return res;
    }

    async function sha256Hmac(message, secret) {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        const msgData = encoder.encode(message);
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
        return arrayBufferToHex(signature);
    }

    function arrayBufferToHex(buffer) {
        const bytes = new Uint8Array(buffer);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function loginWithPass(password) {
        const nonceRes = await fetch('/api/login/nonce', { cache: 'no-store' });
        if (!nonceRes.ok) {
            throw new Error('无法获取登录 nonce');
        }
        const { enabled, nonce } = await nonceRes.json();
        let tokenBody;
        if (enabled) {
            if (!password) {
                throw new Error('请输入密码');
            }
            const hmac = await sha256Hmac(nonce, password);
            tokenBody = `${nonce}.${hmac}`;
        } else {
            // 服务端未启用密码保护，用空签名请求 guest token
            tokenBody = `${nonce}.`;
        }
        const loginRes = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenBody })
        });
        const result = await loginRes.json();
        if (!loginRes.ok || !result.ok) {
            throw new Error(result.error || '登录失败');
        }
        setToken(result.token);
        return result;
    }

    global.HearAuth = {
        getToken,
        setToken,
        clearToken,
        isLoggedIn,
        apiFetch,
        loginWithPass
    };
})(window);
