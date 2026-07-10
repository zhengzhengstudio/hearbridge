const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.HEAR_PORT || process.env.PORT || 8118);
const HEAR_ROOT = process.env.HEAR_ROOT || path.resolve(__dirname, 'public');

console.log(`🌉 HearBridge Server initializing...`);
console.log(`📁 HEAR_ROOT: ${HEAR_ROOT}`);
console.log(`📁 Files exist: ${fs.existsSync(HEAR_ROOT)}`);

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    next();
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
        exists: fs.existsSync(HEAR_ROOT)
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
