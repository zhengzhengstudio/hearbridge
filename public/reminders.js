(function () {
    const supportsVibration = 'vibrate' in navigator;
    let reminders = [];
    const els = {
        count: document.getElementById('reminderCount'),
        status: document.getElementById('vibrationStatus'),
        text: document.getElementById('reminderText'),
        add: document.getElementById('addReminder'),
        test: document.getElementById('testVibrate'),
        clear: document.getElementById('clearReminders'),
        list: document.getElementById('reminderList'),
        toast: document.getElementById('toast')
    };
    els.status.textContent = supportsVibration ? '当前设备支持网页震动测试。' : '当前设备不支持网页震动。';

    init();

    async function init() {
        await loadBackendState();
        render();
        els.add.addEventListener('click', add);
        els.test.addEventListener('click', () => vibrate([180, 80, 180, 80, 260]));
        els.clear.addEventListener('click', () => {
            reminders = [];
            persistBackendState();
            render();
            toast('提醒已清空。');
        });
        els.text.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
    }

    async function loadBackendState() {
        try {
            const res = await HearAuth.apiFetch('/api/data', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            reminders = Array.isArray(data.reminders) ? data.reminders : [];
        } catch (err) {
            console.warn('[HearBridge] 加载后端状态失败:', err.message);
        }
    }

    async function persistBackendState() {
        try {
            await HearAuth.apiFetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reminders })
            });
        } catch (err) {
            console.warn('[HearBridge] 保存后端状态失败:', err.message);
        }
    }

    function add() {
        const text = els.text.value.trim();
        if (!text) return toast('请输入提醒内容。');
        reminders.unshift({ id: Date.now().toString(36), text, createdAt: new Date().toLocaleString('zh-CN') });
        reminders = reminders.slice(0, 20);
        els.text.value = '';
        persistBackendState();
        render();
        vibrate([120, 60, 120]);
        toast('提醒已保存。');
    }

    function render() {
        els.count.textContent = String(reminders.length);
        els.list.innerHTML = reminders.length
            ? reminders.map(item => `<li><span>${escapeHtml(item.text)} · ${escapeHtml(item.createdAt)}</span><button type="button" data-remove="${escapeHtml(item.id)}">删除</button></li>`).join('')
            : '<li><span>还没有提醒。可添加“吃药”“开会”“出门”等。</span></li>';
        els.list.querySelectorAll('[data-remove]').forEach(button => {
            button.addEventListener('click', () => {
                reminders = reminders.filter(item => item.id !== button.dataset.remove);
                persistBackendState();
                render();
            });
        });
    }

    function vibrate(pattern) {
        if (!supportsVibration) return toast('当前设备不支持网页震动。');
        navigator.vibrate(pattern);
    }

    let toastTimer = null;
    function toast(message) {
        clearTimeout(toastTimer);
        els.toast.textContent = message;
        els.toast.classList.add('show');
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
    }

    function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
})();
