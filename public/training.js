(function () {
    const state = {
        hotwords: [],
        samples: [],
        corrections: []
    };
    const els = {
        score: document.getElementById('trainingScore'),
        hotwordInput: document.getElementById('hotwordInput'),
        addHotword: document.getElementById('addHotword'),
        hotwordGrid: document.getElementById('hotwordGrid'),
        wrongWord: document.getElementById('wrongWord'),
        rightWord: document.getElementById('rightWord'),
        addCorrection: document.getElementById('addCorrection'),
        correctionList: document.getElementById('correctionList'),
        sampleList: document.getElementById('sampleList'),
        clearTraining: document.getElementById('clearTraining'),
        toast: document.getElementById('toast')
    };

    init();

    async function init() {
        await loadBackendState();
        render();
        els.addHotword.addEventListener('click', addHotword);
        els.hotwordInput.addEventListener('keydown', event => { if (event.key === 'Enter') addHotword(); });
        els.addCorrection.addEventListener('click', addCorrection);
        els.clearTraining.addEventListener('click', clearTraining);
    }

    async function loadBackendState() {
        try {
            const res = await HearAuth.apiFetch('/api/data', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            state.hotwords = Array.isArray(data.hotwords) ? data.hotwords : [];
            state.samples = Array.isArray(data.samples) ? data.samples : [];
            state.corrections = Array.isArray(data.corrections) ? data.corrections : [];
        } catch (err) {
            console.warn('[HearBridge] 加载后端状态失败:', err.message);
        }
    }

    async function persistBackendState() {
        try {
            await HearAuth.apiFetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hotwords: state.hotwords,
                    samples: state.samples,
                    corrections: state.corrections
                })
            });
        } catch (err) {
            console.warn('[HearBridge] 保存后端状态失败:', err.message);
        }
    }

    function addHotword() {
        const value = els.hotwordInput.value.trim().slice(0, 40);
        if (!value) return toast('请输入热词。');
        state.hotwords = [value, ...state.hotwords.filter(item => item !== value)].slice(0, 30);
        els.hotwordInput.value = '';
        persistBackendState();
        render();
        toast('热词已保存。');
    }

    function addCorrection() {
        const wrong = els.wrongWord.value.trim().slice(0, 40);
        const right = els.rightWord.value.trim().slice(0, 40);
        if (!wrong || !right) return toast('请填写错词和正确词。');
        state.corrections.unshift({ wrong, right, createdAt: new Date().toLocaleString('zh-CN') });
        state.corrections = state.corrections.slice(0, 20);
        els.wrongWord.value = '';
        els.rightWord.value = '';
        persistBackendState();
        render();
        toast('错词修正已保存。');
    }

    function clearTraining() {
        state.hotwords = [];
        state.samples = [];
        state.corrections = [];
        persistBackendState();
        render();
        toast('训练数据已清空。');
    }

    function render() {
        els.score.textContent = String(state.hotwords.length + state.samples.length + state.corrections.length);
        els.hotwordGrid.innerHTML = state.hotwords.length
            ? state.hotwords.map(item => `<span class="hotword-chip">${escapeHtml(item)}</span>`).join('')
            : '<span class="empty-hotword">还没有热词</span>';
        els.correctionList.innerHTML = state.corrections.length
            ? state.corrections.map(item => `<li><span>${escapeHtml(item.wrong)} → ${escapeHtml(item.right)}</span><small>${escapeHtml(item.createdAt)}</small></li>`).join('')
            : '<li><span>还没有错词修正。</span></li>';
        els.sampleList.innerHTML = state.samples.length
            ? state.samples.map(item => `<li><span>${escapeHtml(item.level || item.type)}：${escapeHtml(item.text || '')}</span><small>${escapeHtml(item.createdAt || '')}</small></li>`).join('')
            : '<li><span>还没有训练样本。先去闯关完成一题。</span></li>';
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
