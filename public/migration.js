(function () {
    const button = document.getElementById('migrateData');
    if (!button) return;

    button.addEventListener('click', migrateData);

    function readLocalStorageItem(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    async function migrateData() {
        button.disabled = true;
        button.textContent = '正在迁移...';

        const reminders = readLocalStorageItem('hearbridge_reminders_v1') || [];
        const hotwords = readLocalStorageItem('hearbridge_hotwords_v1') || [];
        const samples = readLocalStorageItem('hearbridge_training_samples_v1') || [];
        const corrections = readLocalStorageItem('hearbridge_corrections_v1') || [];
        const completedLevels = readLocalStorageItem('hearbridge_completed_levels_v1') || [];
        const xp = Number(localStorage.getItem('hearbridge_xp_v1') || '0') || 0;
        const passport = readLocalStorageItem('hearbridge_passport_v1') || null;

        const payload = {};
        if (reminders.length) payload.reminders = reminders;
        if (hotwords.length) payload.hotwords = hotwords;
        if (samples.length) payload.samples = samples;
        if (corrections.length) payload.corrections = corrections;
        if (completedLevels.length) payload.completedLevels = completedLevels;
        if (xp) payload.xp = xp;
        if (passport) payload.passport = passport;

        try {
            const res = await HearAuth.apiFetch('/api/data/migrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.ok) {
                // 迁移成功后清空旧 localStorage
                localStorage.removeItem('hearbridge_reminders_v1');
                localStorage.removeItem('hearbridge_hotwords_v1');
                localStorage.removeItem('hearbridge_training_samples_v1');
                localStorage.removeItem('hearbridge_corrections_v1');
                localStorage.removeItem('hearbridge_completed_levels_v1');
                localStorage.removeItem('hearbridge_xp_v1');
                localStorage.removeItem('hearbridge_passport_v1');
                button.textContent = '迁移完成，请刷新页面';
                showToast('旧数据已迁移到后端，页面刷新后生效。');
            } else {
                throw new Error(data.error || '迁移失败');
            }
        } catch (err) {
            button.disabled = false;
            button.textContent = '从本机迁移旧数据到后端';
            showToast('迁移失败：' + err.message);
        }
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
})();
