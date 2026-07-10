const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.HEAR_PORT || process.env.PORT || 8118);
const HEAR_ROOT = process.env.HEAR_ROOT || path.resolve(__dirname, 'public');
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// 通行证密码，未配置则关闭登录保护
const HEAR_PASS = process.env.HEAR_PASS || '';

console.log(`🌉 HearBridge Server initializing...`);
console.log(`📁 HEAR_ROOT: ${HEAR_ROOT}`);
console.log(`🔐 Login enabled: ${HEAR_PASS ? 'yes' : 'no'}`);
console.log(`📁 Files exist: ${fs.existsSync(HEAR_ROOT)}`);

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});

app.use(express.json());

/**
 * 生成一次性 nonce，用于前端对口令做简单混淆。
 * 这并不是安全加固，只是避免明文口令被浏览器插件直接读到。
 */
app.get('/api/login/nonce', (req, res) => {
    res.json({
        enabled: Boolean(HEAR_PASS),
        nonce: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')
    });
});

app.post('/api/login', (req, res) => {
    if (!HEAR_PASS) {
        res.json({ ok: true, token: signToken('guest') });
        return;
    }

    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
        res.status(400).json({ ok: false, error: 'missing_token' });
        return;
    }

    // 前端传的是 HMAC-SHA256(HEAR_PASS, nonce)，这里做一次简单时间常量比较
    const expected = crypto.createHmac('sha256', HEAR_PASS).update(token.split('.')[0] || '').digest('hex');
    const provided = token.split('.')[1] || '';

    if (!timingSafeEqualHex(expected, provided)) {
        res.status(401).json({ ok: false, error: 'invalid_pass' });
        return;
    }

    res.json({ ok: true, token: signToken('user') });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        product: 'HearBridge',
        port: PORT,
        root: HEAR_ROOT,
        exists: fs.existsSync(HEAR_ROOT),
        asr: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
        asrModel: OPENAI_TRANSCRIBE_MODEL,
        login: Boolean(HEAR_PASS)
    });
});

app.post('/api/transcribe', authorize, express.raw({
    type: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'application/octet-stream'],
    limit: MAX_AUDIO_BYTES
}), async (req, res) => {
    try {
        if (!process.env.OPENAI_API_KEY) {
            res.status(503).json({
                error: 'asr_not_configured',
                message: '云端转写还没有配置服务端 API Key。'
            });
            return;
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            res.status(400).json({
                error: 'empty_audio',
                message: '没有收到录音内容。'
            });
            return;
        }

        const text = await transcribeAudio(req.body, req.headers['content-type'] || 'audio/webm');
        res.json({ text, model: OPENAI_TRANSCRIBE_MODEL });
    } catch (error) {
        console.error('[HearBridge] Transcription failed:', error.message);
        res.status(error.status || 502).json({
            error: 'transcription_failed',
            message: error.publicMessage || '转写暂时失败，请稍后重试或改用打字。'
        });
    }
});

app.use(authorize, express.static(HEAR_ROOT, {
    index: ['index.html'],
    extensions: ['html', 'htm'],
    setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'].includes(ext)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return;
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

app.use((req, res) => {
    const indexPath = path.join(HEAR_ROOT, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`HearBridge site not found - HEAR_ROOT: ${HEAR_ROOT}`);
    }
});

app.listen(PORT, () => {
    console.log(`🌉 HearBridge Server running on port ${PORT}`);
    console.log(`📁 Serving files from: ${HEAR_ROOT}`);
});

function signToken(role) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'HearBridge' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ role, iat: issuedAt, exp: issuedAt + 60 * 60 * 24 })).toString('base64url');
    return `${header}.${payload}.`;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[2] !== '') return false;

    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        return payload && typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
    } catch (error) {
        return false;
    }
}

function authorize(req, res, next) {
    if (!HEAR_PASS) {
        next();
        return;
    }

    // 放行登录相关接口和静态资源根目录（由前端登录层处理）
    const publicPaths = ['/api/login', '/api/login/nonce', '/api/status'];
    if (publicPaths.includes(req.path)) {
        next();
        return;
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (verifyToken(token)) {
        next();
        return;
    }

    res.status(401).json({ error: 'login_required', message: '请先登录。' });
}

function timingSafeEqualHex(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

async function transcribeAudio(audioBuffer, mimeType) {
    if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
        const error = new Error('Current Node.js runtime does not support fetch/FormData/Blob.');
        error.status = 500;
        error.publicMessage = '服务器 Node.js 版本不支持内置上传能力。';
        throw error;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    const extension = mimeType.includes('mp4') ? 'mp4'
        : mimeType.includes('mpeg') ? 'mp3'
            : mimeType.includes('wav') ? 'wav'
                : 'webm';

    try {
        const form = new FormData();
        form.append('model', OPENAI_TRANSCRIBE_MODEL);
        form.append('language', 'zh');
        form.append('file', new Blob([audioBuffer], { type: mimeType }), `hearbridge.${extension}`);

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: form,
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            const error = new Error(payload.error?.message || `OpenAI transcription failed: ${response.status}`);
            error.status = response.status >= 500 ? 502 : response.status;
            error.publicMessage = response.status === 401
                ? '云端转写密钥无效，请检查服务端配置。'
                : '云端转写暂时失败，请稍后重试。';
            throw error;
        }

        return String(payload.text || '').trim();
    } catch (error) {
        if (error.name === 'AbortError') {
            error.publicMessage = '云端转写超时，请缩短录音后重试。';
            error.status = 504;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
