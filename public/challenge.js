(function () {
    const levels = [
        {
            id: 'hospital-mask',
            title: '医院口罩沟通',
            scene: '医生说话很快，还戴着口罩，你需要拿到诊断、药量和注意事项。',
            goal: '把“请写下重点”说清楚。',
            suggested: '我听不清，也不方便看口型。请您把诊断、用药和注意事项写下来，谢谢。',
            tags: ['医院', '药量', '注意事项']
        },
        {
            id: 'metro-wayfinding',
            title: '地铁问路',
            scene: '站台很吵，你要确认换乘方向和站名。',
            goal: '让工作人员用文字告诉你路线。',
            suggested: '您好，我是听障人士。请用文字告诉我在哪一站换乘，以及往哪个方向走。',
            tags: ['地铁', '换乘', '站名']
        },
        {
            id: 'work-confirm',
            title: '工作确认',
            scene: '同事口头交代了一个复杂任务，你担心漏掉时间和下一步。',
            goal: '把口头任务转成文字确认。',
            suggested: '这件事比较复杂，我更适合文字确认。请把截止时间、负责人和下一步发给我。',
            tags: ['工作', '截止时间', '负责人']
        },
        {
            id: 'shopping-service',
            title: '购物服务',
            scene: '店员解释价格、规格和取货方式，你需要避免听错。',
            goal: '请对方写清金额和规格。',
            suggested: '我听不清价格和说明，请您把金额、规格和取货方式写给我看。',
            tags: ['金额', '规格', '取货']
        },
        {
            id: 'emergency-help',
            title: '紧急求助',
            scene: '周围有人喊话，但你听不清发生了什么，需要快速求助。',
            goal: '说明不要只用语音呼喊。',
            suggested: '我听不见，请不要只用语音呼喊。请用文字告诉我发生了什么，并帮我联系工作人员。',
            tags: ['紧急', '工作人员', '文字']
        }
    ];

    const state = {
        active: levels[0],
        xp: readNumber('hearbridge_xp_v1'),
        completed: readList('hearbridge_completed_levels_v1'),
        hotwords: readList('hearbridge_hotwords_v1'),
        samples: readList('hearbridge_training_samples_v1')
    };

    const els = {
        levelList: document.getElementById('levelList'),
        xpValue: document.getElementById('xpValue'),
        levelTitle: document.getElementById('levelTitle'),
        levelGoal: document.getElementById('levelGoal'),
        scenarioRole: document.getElementById('scenarioRole'),
        scenarioText: document.getElementById('scenarioText'),
        answerText: document.getElementById('answerText'),
        completeLevel: document.getElementById('completeLevel'),
        saveChallengeSample: document.getElementById('saveChallengeSample'),
        useSuggested: document.getElementById('useSuggested'),
        toast: document.getElementById('toast')
    };

    render();
    bind();

    function bind() {
        els.completeLevel.addEventListener('click', completeLevel);
        els.saveChallengeSample.addEventListener('click', saveSample);
        els.useSuggested.addEventListener('click', () => {
            els.answerText.value = state.active.suggested;
            toast('已填入推荐表达。');
        });
    }

    function render() {
        els.xpValue.textContent = String(state.xp);
        els.levelList.innerHTML = levels.map((level, index) => {
            const done = state.completed.includes(level.id);
            return `
                <button class="level-card ${state.active.id === level.id ? 'active' : ''}" type="button" data-level="${level.id}">
                    <span class="level-badge">${done ? '✓' : index + 1}</span>
                    <span>
                        <h2>${escapeHtml(level.title)}</h2>
                        <p>${escapeHtml(level.goal)}</p>
                    </span>
                    <span class="level-meta">${done ? '已完成' : '未完成'}</span>
                </button>
            `;
        }).join('');
        els.levelList.querySelectorAll('[data-level]').forEach(button => {
            button.addEventListener('click', () => {
                state.active = levels.find(level => level.id === button.dataset.level) || levels[0];
                renderActive();
                render();
            });
        });
        renderActive();
    }

    function renderActive() {
        els.levelTitle.textContent = state.active.title;
        els.levelGoal.textContent = state.active.goal;
        els.scenarioRole.textContent = `场景 · ${state.active.tags.join(' / ')}`;
        els.scenarioText.textContent = state.active.scene;
        if (!els.answerText.value.trim()) els.answerText.value = state.active.suggested;
    }

    function completeLevel() {
        const answer = els.answerText.value.trim();
        if (!answer) {
            toast('先写一句你要给对方看的话。');
            return;
        }
        if (!state.completed.includes(state.active.id)) state.completed.push(state.active.id);
        state.xp += 20;
        addHotwords(state.active.tags);
        saveSampleRecord('typed-answer', answer);
        persist();
        render();
        toast('本关完成，训练经验 +20。');
    }

    function saveSample() {
        saveSampleRecord('recording-marker', `${state.active.title}：需要补充录音样本`);
        state.xp += 8;
        persist();
        render();
        toast('已为这一关打样本标记，训练经验 +8。');
    }

    function addHotwords(words) {
        state.hotwords = [...words, ...state.hotwords].filter((item, index, array) => item && array.indexOf(item) === index).slice(0, 20);
    }

    function saveSampleRecord(type, text) {
        state.samples.unshift({
            id: Date.now().toString(36),
            type,
            level: state.active.title,
            text,
            createdAt: new Date().toLocaleString('zh-CN')
        });
        state.samples = state.samples.slice(0, 30);
    }

    function persist() {
        localStorage.setItem('hearbridge_xp_v1', String(state.xp));
        localStorage.setItem('hearbridge_completed_levels_v1', JSON.stringify(state.completed));
        localStorage.setItem('hearbridge_hotwords_v1', JSON.stringify(state.hotwords));
        localStorage.setItem('hearbridge_training_samples_v1', JSON.stringify(state.samples));
    }

    function readNumber(key) {
        return Number(localStorage.getItem(key) || '0') || 0;
    }

    function readList(key) {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    let toastTimer = null;
    function toast(message) {
        window.clearTimeout(toastTimer);
        els.toast.textContent = message;
        els.toast.classList.add('show');
        toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2600);
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})();
