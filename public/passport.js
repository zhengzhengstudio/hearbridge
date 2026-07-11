(function () {
    const defaults = {
        headline: '我是听障人士',
        message: '请用文字和我沟通，或放慢语速，每次只说一句。',
        contact: '未填写',
        note: '请写下时间、地点、金额和药量。'
    };
    let data = { ...defaults };

    const els = {
        headline: document.getElementById('passportHeadline'),
        message: document.getElementById('passportMessage'),
        contact: document.getElementById('passportContact'),
        note: document.getElementById('passportNote'),
        headlineInput: document.getElementById('headlineInput'),
        messageInput: document.getElementById('messageInput'),
        contactInput: document.getElementById('contactInput'),
        noteInput: document.getElementById('noteInput'),
        save: document.getElementById('savePassport'),
        reset: document.getElementById('resetPassport'),
        toast: document.getElementById('toast'),
        hearingPassport: document.getElementById('hearingPassport'),
        zhengzhengPassport: document.getElementById('zhengzhengPassport'),
        tabs: document.querySelectorAll('.tab-button'),
        zhengzhengPassInput: document.getElementById('zhengzhengPassInput'),
        loginZhengZheng: document.getElementById('loginZhengZheng'),
        logoutZhengZheng: document.getElementById('logoutZhengZheng'),
        loginStatus: document.getElementById('loginStatus'),
        loginHint: document.getElementById('loginHint'),
        loginCard: document.getElementById('loginCard')
    };

    init();

    async function init() {
        await loadBackendState();
        render();
        bindTabs();
        bindHearingActions();
        bindLogin();
        updateLoginUI();
        els.save.addEventListener('click', save);
        els.reset.addEventListener('click', reset);
    }

    async function loadBackendState() {
        try {
            const res = await HearAuth.apiFetch('/api/data', { cache: 'no-store' });
            if (!res.ok) return;
            const state = await res.json();
            if (state.passport && typeof state.passport === 'object') {
                data = { ...defaults, ...state.passport };
            }
        } catch (err) {
            console.warn('[HearBridge] 加载后端状态失败:', err.message);
        }
    }

    async function persistBackendState() {
        try {
            await HearAuth.apiFetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passport: data })
            });
        } catch (err) {
            console.warn('[HearBridge] 保存后端状态失败:', err.message);
        }
    }

    function render() {
        els.headline.textContent = data.headline;
        els.message.textContent = data.message;
        els.contact.textContent = data.contact;
        els.note.textContent = data.note;
        els.headlineInput.value = data.headline;
        els.messageInput.value = data.message;
        els.contactInput.value = data.contact === '未填写' ? '' : data.contact;
        els.noteInput.value = data.note;
    }

    function save() {
        data = {
            headline: els.headlineInput.value.trim() || defaults.headline,
            message: els.messageInput.value.trim() || defaults.message,
            contact: els.contactInput.value.trim() || defaults.contact,
            note: els.noteInput.value.trim() || defaults.note
        };
        persistBackendState();
        render();
        toast('通行证已保存。');
    }

    function reset() {
        data = { ...defaults };
        persistBackendState();
        render();
        toast('已恢复默认通行证。');
    }

    function bindTabs() {
        els.tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                els.tabs.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                if (tab === 'hearing') {
                    els.hearingPassport.removeAttribute('hidden');
                    els.zhengzhengPassport.setAttribute('hidden', '');
                } else {
                    els.hearingPassport.setAttribute('hidden', '');
                    els.zhengzhengPassport.removeAttribute('hidden');
                }
            });
        });
    }

    function bindHearingActions() {
        document.getElementById('downloadHearing').addEventListener('click', () => {
            const canvas = drawHearingPassport();
            downloadCanvas(canvas, '听障通行证.png');
            toast('图片已下载');
        });
        document.getElementById('shareHearing').addEventListener('click', async () => {
            await copyText(buildHearingText(), '听障通行证文本已复制');
        });
    }

    function bindLogin() {
        els.loginZhengZheng.addEventListener('click', async () => {
            const password = els.zhengzhengPassInput.value;
            try {
                await HearAuth.loginWithPass(password);
                toast('登录成功，正在同步数据...');
                els.zhengzhengPassInput.value = '';
                updateLoginUI();
                await autoMigrate();
                window.location.href = './?login=success';
            } catch (err) {
                toast('登录失败：' + err.message);
            }
        });
        els.logoutZhengZheng.addEventListener('click', () => {
            HearAuth.clearToken();
            updateLoginUI();
            toast('已退出登录');
        });
    }

    async function autoMigrate() {
        try {
            const payload = collectLocalStorageData();
            if (!payload || Object.keys(payload).length === 0) return;
            const res = await HearAuth.apiFetch('/api/data/migrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (result.ok) {
                clearLocalStorageData();
                toast('本地数据已同步到后端');
            }
        } catch (err) {
            console.warn('自动迁移失败:', err);
            toast('数据同步失败：' + err.message);
        }
    }

    function collectLocalStorageData() {
        function read(key) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        }
        const payload = {};
        const reminders = read('hearbridge_reminders_v1') || [];
        const hotwords = read('hearbridge_hotwords_v1') || [];
        const samples = read('hearbridge_training_samples_v1') || [];
        const corrections = read('hearbridge_corrections_v1') || [];
        const completedLevels = read('hearbridge_completed_levels_v1') || [];
        const xp = Number(localStorage.getItem('hearbridge_xp_v1') || '0') || 0;
        const passport = read('hearbridge_passport_v1') || null;

        if (reminders.length) payload.reminders = reminders;
        if (hotwords.length) payload.hotwords = hotwords;
        if (samples.length) payload.samples = samples;
        if (corrections.length) payload.corrections = corrections;
        if (completedLevels.length) payload.completedLevels = completedLevels;
        if (xp) payload.xp = xp;
        if (passport) payload.passport = passport;
        return payload;
    }

    function clearLocalStorageData() {
        [
            'hearbridge_reminders_v1',
            'hearbridge_hotwords_v1',
            'hearbridge_training_samples_v1',
            'hearbridge_corrections_v1',
            'hearbridge_completed_levels_v1',
            'hearbridge_xp_v1',
            'hearbridge_passport_v1'
        ].forEach(key => localStorage.removeItem(key));
    }

    function updateLoginUI() {
        const loggedIn = HearAuth.isLoggedIn();
        if (loggedIn) {
            els.loginStatus.textContent = '已登录';
            els.loginStatus.classList.add('logged-in');
            els.logoutZhengZheng.removeAttribute('hidden');
            els.loginCard.setAttribute('hidden', '');
            els.loginHint.textContent = '当前已持有后端访问令牌。';
        } else {
            els.loginStatus.textContent = '未登录';
            els.loginStatus.classList.remove('logged-in');
            els.logoutZhengZheng.setAttribute('hidden', '');
            els.loginCard.removeAttribute('hidden');
            els.loginHint.textContent = '密码由服务端 HEAR_PASS 环境变量设置。未设置时无需登录。';
        }
    }

    function buildHearingText() {
        return [
            data.headline,
            data.message,
            '',
            '紧急联系人：' + data.contact,
            '重要提醒：' + data.note,
            '',
            '—— 来自声桥 HearBridge'
        ].join('\n');
    }

    async function copyText(text, successMsg) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            toast(successMsg);
        } catch (err) {
            console.warn('复制失败:', err);
            toast('复制失败，请手动复制');
        }
    }

    function drawHearingPassport() {
        const width = 640;
        const pad = 40;
        const ctx = createCanvas(width);
        const bg = '#164e3f';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, ctx.canvas.height);

        drawHeader(ctx, '声桥 HearBridge', pad, pad, width - pad * 2);

        let y = pad + 56;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        y = wrapText(ctx, data.headline, pad, y, width - pad * 2, 52) + 18;

        ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        y = wrapText(ctx, data.message, pad, y, width - pad * 2, 32) + 30;

        y = drawLine(ctx, '紧急联系人', data.contact, pad, y, width - pad * 2) + 20;
        y = drawLine(ctx, '重要提醒', data.note, pad, y, width - pad * 2) + 20;

        drawFooter(ctx, '长按识别 · 声桥 HearBridge', width, ctx.canvas.height - 24);
        return ctx.canvas;
    }

    function createCanvas(width) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = 960;
        return canvas.getContext('2d');
    }

    function drawHeader(ctx, label, x, y, maxWidth) {
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(label, x, y);
    }

    function drawLine(ctx, label, value, x, y, maxWidth) {
        ctx.fillStyle = 'rgba(255,255,255,0.58)';
        ctx.font = '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(label, x, y);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        return wrapText(ctx, value, x, y + 28, maxWidth, 34);
    }

    function drawFooter(ctx, text, width, y) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const tw = ctx.measureText(text).width;
        ctx.fillText(text, (width - tw) / 2, y);
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const chars = String(text || '').split('');
        let line = '';
        let cy = y;
        for (let i = 0; i < chars.length; i++) {
            const testLine = line + chars[i];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
                ctx.fillText(line, x, cy);
                line = chars[i];
                cy += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, cy);
        return cy;
    }

    function downloadCanvas(canvas, filename) {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 200);
    }

    let toastTimer = null;
    function toast(message) {
        clearTimeout(toastTimer);
        els.toast.textContent = message;
        els.toast.classList.add('show');
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
    }
})();
