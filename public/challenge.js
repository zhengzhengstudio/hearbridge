(function () {
    const levels = [
        {
            id: 'hospital-mask',
            title: '医院口罩沟通',
            scene: '医生戴着口罩，说话很快。你需要拿到诊断、药量和注意事项。',
            goal: '先说明听障，再请医生写下诊断、药量和注意事项。'
        },
        {
            id: 'metro-wayfinding',
            title: '地铁问路',
            scene: '站台很吵，你要确认换乘方向和站名。',
            goal: '请工作人员用文字告诉你路线。'
        },
        {
            id: 'work-confirm',
            title: '工作确认',
            scene: '同事口头交代了一个复杂任务，你担心漏掉时间和下一步。',
            goal: '请同事把口头任务转成文字确认。'
        },
        {
            id: 'shopping-service',
            title: '购物服务',
            scene: '店员解释价格、规格和取货方式，你需要避免听错。',
            goal: '请店员写清金额、规格和取货方式。'
        },
        {
            id: 'emergency-help',
            title: '紧急求助',
            scene: '周围有人喊话，但你听不清发生了什么，需要快速求助。',
            goal: '说明不要只用语音呼喊，请对方用文字或联系工作人员。'
        }
    ];

    const state = {
        active: null,
        mode: 'practice',
        xp: 0,
        completed: [],
        sessionId: null,
        messages: [],
        ended: false,
        won: false,
        score: 0,
        scoreBreakdown: { clarity: 0, strategy: 0, completion: 0 },
        rounds: 0,
        maxRounds: 3,
        recorder: null,
        mediaStream: null,
        audioChunks: [],
        recording: false,
        asrConfigured: false
    };

    const supportsLocalRecording = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

    const els = {
        introSection: document.getElementById('introSection'),
        setupSection: document.getElementById('setupSection'),
        gameSection: document.getElementById('gameSection'),
        resultSection: document.getElementById('resultSection'),
        levelList: document.getElementById('levelList'),
        xpValue: document.getElementById('xpValue'),
        levelTitle: document.getElementById('levelTitle'),
        levelGoal: document.getElementById('levelGoal'),
        scenarioText: document.getElementById('scenarioText'),
        modeSelector: document.getElementById('modeSelector'),
        gameLevelTitle: document.getElementById('gameLevelTitle'),
        gameLevelGoal: document.getElementById('gameLevelGoal'),
        gameScenario: document.getElementById('gameScenario'),
        roundBadge: document.getElementById('roundBadge'),
        modeBadge: document.getElementById('modeBadge'),
        chatBox: document.getElementById('chatBox'),
        answerText: document.getElementById('answerText'),
        completeLevel: document.getElementById('completeLevel'),
        recordAnswer: document.getElementById('recordAnswer'),
        useSuggested: document.getElementById('useSuggested'),
        hintButton: document.getElementById('hintButton'),
        giveUpButton: document.getElementById('giveUpButton'),
        feedback: document.getElementById('feedback'),
        resultTitle: document.getElementById('resultTitle'),
        resultSummary: document.getElementById('resultSummary'),
        scoreClarity: document.getElementById('scoreClarity'),
        scoreStrategy: document.getElementById('scoreStrategy'),
        scoreCompletion: document.getElementById('scoreCompletion'),
        reviewList: document.getElementById('reviewList'),
        replayLevel: document.getElementById('replayLevel'),
        backToSetup: document.getElementById('backToSetup'),
        toast: document.getElementById('toast')
    };

    init();

    async function init() {
        bind();
        await loadBackendState();
        renderLevelList();
        selectLevelOnSetup(levels[0].id);
    }

    async function checkServerAsr() {
        try {
            const res = await HearAuth.apiFetch('/api/status', { cache: 'no-store' });
            const status = await res.json();
            state.asrConfigured = status.asr === 'configured';
        } catch (err) {
            state.asrConfigured = false;
        }
    }

    async function loadBackendState() {
        try {
            const res = await HearAuth.apiFetch('/api/data', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            state.xp = Number(data.xp) || 0;
            state.completed = Array.isArray(data.completedLevels) ? data.completedLevels : [];
        } catch (err) {
            console.warn('[HearBridge] 加载后端状态失败:', err.message);
        }
    }

    function bind() {
        els.levelList.addEventListener('click', handleLevelListClick);
        els.modeSelector.addEventListener('click', handleModeClick);
        els.completeLevel.addEventListener('click', sendPlayerMessage);
        els.useSuggested.addEventListener('click', useSuggested);
        els.hintButton.addEventListener('click', showHint);
        els.giveUpButton.addEventListener('click', endGameSession);
        els.replayLevel.addEventListener('click', () => startGame(state.active.id, state.mode));
        els.backToSetup.addEventListener('click', showSetup);
        if (els.recordAnswer) {
            els.recordAnswer.addEventListener('mousedown', startRecording);
            els.recordAnswer.addEventListener('touchstart', startRecording);
            els.recordAnswer.addEventListener('mouseup', stopRecording);
            els.recordAnswer.addEventListener('mouseleave', stopRecording);
            els.recordAnswer.addEventListener('touchend', stopRecording);
        }
        els.answerText.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendPlayerMessage();
            }
        });
    }

    function handleLevelListClick(event) {
        const card = event.target.closest('[data-level]');
        if (!card) return;
        selectLevelOnSetup(card.dataset.level);
    }

    function handleModeClick(event) {
        const card = event.target.closest('[data-mode]');
        if (!card) return;
        const mode = card.dataset.mode;
        if (state.active) startGame(state.active.id, mode);
    }

    function renderLevelList() {
        els.xpValue.textContent = String(state.xp);
        els.levelList.innerHTML = levels.map((level, index) => {
            const done = state.completed.includes(level.id);
            const selected = state.active && state.active.id === level.id;
            return `
                <button class="level-card ${selected ? 'active' : ''}" type="button" data-level="${level.id}">
                    <span class="level-badge">${done ? '✓' : index + 1}</span>
                    <span>
                        <h2>${escapeHtml(level.title)}</h2>
                        <p>${escapeHtml(level.goal)}</p>
                    </span>
                    <span class="level-meta">${done ? '已完成' : '未完成'}</span>
                </button>
            `;
        }).join('');
    }

    function selectLevelOnSetup(levelId) {
        state.active = levels.find(level => level.id === levelId) || levels[0];
        renderLevelList();
        els.levelTitle.textContent = state.active.title;
        els.levelGoal.textContent = state.active.goal;
        els.scenarioText.textContent = state.active.scene;
    }

    function showSetup() {
        els.gameSection.hidden = true;
        els.resultSection.hidden = true;
        els.setupSection.hidden = false;
        els.introSection.hidden = false;
        renderLevelList();
    }

    async function startGame(levelId, mode) {
        state.active = levels.find(level => level.id === levelId) || levels[0];
        state.mode = mode;
        state.ended = false;
        state.won = false;
        state.messages = [];
        state.score = 0;
        state.scoreBreakdown = { clarity: 0, strategy: 0, completion: 0 };
        state.rounds = 0;
        els.answerText.value = '';
        showFeedback('');

        els.setupSection.hidden = true;
        els.introSection.hidden = true;
        els.gameSection.hidden = false;
        els.resultSection.hidden = true;

        els.gameLevelTitle.textContent = state.active.title;
        els.gameLevelGoal.textContent = state.active.goal;
        els.gameScenario.querySelector('p').textContent = state.active.scene;
        els.modeBadge.textContent = mode === 'practice' ? '练习模式' : '挑战模式';
        els.roundBadge.textContent = '0 / ?';

        await startGameSession();
    }

    async function startGameSession() {
        try {
            const res = await HearAuth.apiFetch('/api/game/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ levelId: state.active.id, mode: state.mode })
            });
            const data = await res.json();
            if (!data.ok) {
                toast('游戏启动失败，请检查后端服务。');
                return;
            }
            state.sessionId = data.sessionId;
            state.maxRounds = data.level.rounds || 3;
            state.messages = data.messages || [];
            renderGame();
            await checkServerAsr();
        } catch (err) {
            console.warn('[HearBridge] 启动游戏失败:', err.message);
            toast('无法连接后端，请确认 hear_server.js 已启动。');
        }
    }

    function renderGame() {
        els.roundBadge.textContent = `${state.rounds} / ${state.maxRounds}`;
        renderMessages();
    }

    function renderMessages() {
        let html = '';
        for (const m of state.messages) {
            if (m.role === 'npc') {
                html += `<div class="chat-bubble npc"><strong>${escapeHtml(m.text)}</strong><small>AI 沟通对象 <button type="button" class="speak-btn" data-text="${escapeHtml(m.text)}">朗读</button></small></div>`;
            } else {
                html += `<div class="chat-bubble player"><span>${escapeHtml(m.text)}</span><small>你</small></div>`;
            }
        }
        if (state.messages.length === 0) {
            html = '<p class="chat-placeholder">AI 沟通对象会在这里说话。</p>';
        }
        els.chatBox.innerHTML = html;
        els.chatBox.querySelectorAll('.speak-btn').forEach(button => {
            button.addEventListener('click', () => speak(button.dataset.text));
        });
        els.chatBox.scrollTop = els.chatBox.scrollHeight;
    }

    async function sendPlayerMessage() {
        if (state.ended || !state.sessionId) return;
        const text = els.answerText.value.trim();
        if (!text) {
            toast('先写一句你要给对方看的话。');
            return;
        }

        els.answerText.value = '';
        els.completeLevel.disabled = true;

        try {
            const res = await HearAuth.apiFetch('/api/game/talk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: state.sessionId, message: text, mode: state.mode })
            });
            const data = await res.json();
            if (!data.ok) {
                toast('对话失败，请重试。');
                els.completeLevel.disabled = false;
                return;
            }
            state.messages = data.messages;
            state.score = data.score;
            state.scoreBreakdown = data.scoreBreakdown || state.scoreBreakdown;
            state.rounds = data.rounds;
            state.won = data.won;
            state.ended = data.ended;
            renderGame();
            showFeedback(data.feedback);

            if (state.ended) {
                await endGameSession();
            }
        } catch (err) {
            console.warn('[HearBridge] 发送消息失败:', err.message);
            toast('网络错误，请检查后重试。');
        } finally {
            if (!state.ended) els.completeLevel.disabled = false;
        }
    }

    async function endGameSession() {
        if (!state.sessionId) return;
        try {
            const res = await HearAuth.apiFetch('/api/game/end', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: state.sessionId, mode: state.mode })
            });
            const data = await res.json();
            if (data.ok) {
                state.xp = data.totalXp;
                if (data.won && !state.completed.includes(state.active.id)) {
                    state.completed.push(state.active.id);
                }
                showResult(data);
            }
        } catch (err) {
            console.warn('[HearBridge] 结束游戏失败:', err.message);
        } finally {
            state.sessionId = null;
        }
    }

    function showResult(data) {
        els.gameSection.hidden = true;
        els.resultSection.hidden = false;
        els.resultTitle.textContent = data.won ? '通关成功' : '本轮结束';
        els.resultSummary.textContent = data.won
            ? `你成功完成了「${state.active.title}」，获得 ${data.xpGain} 经验。AI 已经把这段对话保存为训练样本。`
            : `本轮没有拿到关键信息。${data.suggestion || '再试一次，记得先说明听障并请求文字。'}`;
        const breakdown = data.scoreBreakdown || state.scoreBreakdown;
        els.scoreClarity.textContent = String(breakdown.clarity || 0);
        els.scoreStrategy.textContent = String(breakdown.strategy || 0);
        els.scoreCompletion.textContent = String(breakdown.completion || 0);
        els.reviewList.innerHTML = (data.reviews || []).map(r => `<div class="review-item"><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.text)}</p></div>`).join('');
    }

    function showFeedback(text) {
        if (!text) {
            els.feedback.hidden = true;
            els.feedback.textContent = '';
            return;
        }
        els.feedback.textContent = text;
        els.feedback.hidden = false;
    }

    function showHint() {
        if (!state.active) return;
        const level = state.active;
        showFeedback(level.suggested || '先说明听障情况，再请求对方用文字写下关键信息。');
    }

    async function useSuggested() {
        if (!state.active) return;
        try {
            const res = await HearAuth.apiFetch('/api/game/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ levelId: state.active.id })
            });
            const data = await res.json();
            if (!data.ok) return;
            els.answerText.value = data.level.suggested || '';
            toast('已填入推荐表达。');
        } catch (err) {
            console.warn('[HearBridge] 获取推荐表达失败:', err.message);
        }
    }

    async function startRecording(event) {
        event.preventDefault();
        if (!supportsLocalRecording || state.recording || !state.asrConfigured) {
            if (!state.asrConfigured) toast('后端没有配置语音转写，请先用打字。');
            return;
        }
        try {
            state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            state.audioChunks = [];
            state.recorder = new MediaRecorder(state.mediaStream);
            state.recorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) state.audioChunks.push(event.data);
            });
            state.recorder.addEventListener('stop', handleRecordingStop);
            state.recorder.start();
            state.recording = true;
            els.recordAnswer.textContent = '录音中...';
            els.recordAnswer.classList.add('recording');
        } catch (error) {
            toast('无法打开麦克风，请检查权限。');
        }
    }

    function stopRecording(event) {
        event.preventDefault();
        if (!state.recorder || !state.recording) return;
        state.recorder.stop();
    }

    async function handleRecordingStop() {
        const blob = new Blob(state.audioChunks, { type: state.recorder?.mimeType || 'audio/webm' });
        state.recording = false;
        state.recorder = null;
        stopMediaStream();
        els.recordAnswer.textContent = '按住录音';
        els.recordAnswer.classList.remove('recording');
        if (!blob.size) return;
        toast('正在转文字...');
        try {
            const res = await HearAuth.apiFetch('/api/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': blob.type || 'audio/webm' },
                body: blob
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast(payload.message || '转写失败，请改用打字。');
                return;
            }
            const text = String(payload.text || '').trim();
            if (!text) {
                toast('没有识别到内容，请重试。');
                return;
            }
            els.answerText.value = text;
            toast('已转文字，点击发送即可。');
        } catch (error) {
            toast('转写请求失败，请改用打字。');
        }
    }

    function stopMediaStream() {
        if (!state.mediaStream) return;
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }

    async function speak(text) {
        try {
            const res = await HearAuth.apiFetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.slice(0, 500), voice: 'shimmer', speed: '0.95' })
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.message || '朗读失败');
            }
            const blob = await res.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            audio.play();
        } catch (error) {
            console.warn('[HearBridge] 朗读失败:', error.message);
            toast('朗读失败：' + error.message);
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
