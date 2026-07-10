const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.HEAR_PORT || process.env.PORT || 8118);
const HEAR_ROOT = process.env.HEAR_ROOT || path.resolve(__dirname, 'public');
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

console.log(`🌉 HearBridge Server initializing...`);
console.log(`📁 HEAR_ROOT: ${HEAR_ROOT}`);
console.log(`📁 Files exist: ${fs.existsSync(HEAR_ROOT)}`);

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

app.post('/api/transcribe', express.raw({
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

app.use(express.static(HEAR_ROOT, {
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

app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        product: 'HearBridge',
        port: PORT,
        root: HEAR_ROOT,
        exists: fs.existsSync(HEAR_ROOT),
        asr: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
        asrModel: OPENAI_TRANSCRIBE_MODEL
    });
});

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
