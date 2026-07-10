(function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const supportsRecognition = Boolean(SpeechRecognition);
    const supportsSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const supportsVibration = 'vibrate' in navigator;

    const phrases = [
        {
            title: '医院就诊',
            text: '我听不清，也不方便看口型。请您把诊断、用药和注意事项写下来，或说慢一点。',
            emergency: false
        },
        {
            title: '通勤问路',
            text: '您好，我是听障人士。请用文字告诉我应该往哪里走，或把站名写给我。',
            emergency: false
        },
        {
            title: '工作沟通',
            text: '这件事比较复杂，我更适合用文字确认。请把重点、时间和下一步发给我。',
            emergency: false
        },
        {
            title: '购物服务',
            text: '我听不清价格和说明，请您把金额、规格和取货方式写给我看。',
            emergency: false
        },
        {
            title: '请慢一点',
            text: '我能感知声音，但听不懂内容。请您放慢语速，每次说短一点。',
            emergency: false
        },
        {
            title: '紧急求助',
            text: '我听不见，请不要只用语音呼喊。请用文字告诉我发生了什么，并帮我联系家人或工作人员。',
            emergency: true
        }
    ];

    const roles = {
        self: {
            label: '当前角色：听障本人',
            summary: '先打开字幕；识别不准时，切到打字或短句卡片给对方看。',
            tip: '建议一句话只说一个重点。',
            display: '我听不清，请用文字和我沟通，或者说慢一点。',
            draft: '我听不清，请您把重点写下来，或者说慢一点。',
            hints: ['医院口罩场景：建议靠近收音并请医生用短句。', '方言/多人场景：识别失败时切换到打字卡片。']
        },
        partner: {
            label: '当前角色：沟通对象',
            summary: '你可以把要说的话打出来，按“发送并朗读”，再让对方确认是否理解。',
            tip: '请使用短句，每次只讲一个信息。',
            display: '我们慢一点说，每次一句。你可以随时让我写下来。',
            draft: '我们慢一点说，每次一句。你可以随时让我写下来。',
            hints: ['对方可能能听见声音，但不一定听懂内容。', '重要信息请写下来：时间、地点、金额、药量。']
        },
        care: {
            label: '当前角色：照护提醒',
            summary: '先把吃药、出门、开会等高频事项放进本地提醒，再测试震动是否有效。',
            tip: '提醒文字尽量具体，例如“20:30 吃降压药”。',
            display: '请看这里：下一件事是提醒事项，请确认时间和内容。',
            draft: '请看这里：下一件事是提醒事项，请确认时间和内容。',
            hints: ['网页震动适合测试和临时提示，正式提醒仍建议配合系统闹钟。', '照护沟通里，时间和动作最好写成明确文字。']
        }
    };

    const state = {
        recognition: null,
        listening: false,
        transcript: [],
        reminders: loadReminders()
    };

    const els = {
        recognitionStatus: document.getElementById('recognitionStatus'),
        vibrationStatus: document.getElementById('vibrationStatus'),
        micState: document.getElementById('micState'),
        captionDisplay: document.getElementById('captionDisplay'),
        startCaption: document.getElementById('startCaption'),
        stopCaption: document.getElementById('stopCaption'),
        copyCaption: document.getElementById('copyCaption'),
        clearCaption: document.getElementById('clearCaption'),
        sayText: document.getElementById('sayText'),
        speakText: document.getElementById('speakText'),
        showText: document.getElementById('showText'),
        phraseGrid: document.getElementById('phraseGrid'),
        displayText: document.getElementById('displayText'),
        speakDisplay: document.getElementById('speakDisplay'),
        reminderText: document.getElementById('reminderText'),
        addReminder: document.getElementById('addReminder'),
        testVibrate: document.getElementById('testVibrate'),
        clearReminders: document.getElementById('clearReminders'),
        reminderList: document.getElementById('reminderList'),
        roleLabel: document.getElementById('roleLabel'),
        roleSummary: document.getElementById('roleSummary'),
        roleAction: document.getElementById('roleAction'),
        captionHintPrimary: document.getElementById('captionHintPrimary'),
        captionHintSecondary: document.getElementById('captionHintSecondary'),
        composeTip: document.getElementById('composeTip'),
        sayCount: document.getElementById('sayCount'),
        toast: document.getElementById('toast')
    };

    init();

    function init() {
        renderCapabilities();
        applyRole('self', false);
        renderPhrases();
        renderReminders();
        bindEvents();
        if (supportsRecognition) setupRecognition();
    }

    function renderCapabilities() {
        if (supportsRecognition) {
            els.recognitionStatus.textContent = '当前浏览器支持语音识别。识别质量会受方言、口罩、距离和网络影响。';
        } else {
            els.recognitionStatus.textContent = '当前浏览器不支持实时语音识别；仍可使用打字发声、常用语和提醒。';
            els.startCaption.disabled = true;
        }

        els.vibrationStatus.textContent = supportsVibration
            ? '当前设备支持震动测试。实际提醒请配合系统闹钟使用。'
            : '当前设备不支持网页震动；可以保留文字提醒。';

        if (!supportsSpeech) {
            els.speakText.disabled = true;
            els.speakDisplay.disabled = true;
        }
    }

    function bindEvents() {
        els.startCaption.addEventListener('click', startListening);
        els.stopCaption.addEventListener('click', stopListening);
        els.copyCaption.addEventListener('click', copyTranscript);
        els.clearCaption.addEventListener('click', clearTranscript);
        els.speakText.addEventListener('click', () => speak(els.sayText.value.trim()));
        els.showText.addEventListener('click', () => showLarge(els.sayText.value.trim()));
        els.speakDisplay.addEventListener('click', () => speak(els.displayText.textContent.trim()));
        els.addReminder.addEventListener('click', addReminder);
        els.testVibrate.addEventListener('click', () => vibrate([180, 80, 180, 80, 260]));
        els.clearReminders.addEventListener('click', clearReminders);
        els.roleAction.addEventListener('click', prepareRoleDraft);
        els.sayText.addEventListener('input', updateSayCount);

        els.reminderText.addEventListener('keydown', event => {
            if (event.key === 'Enter') addReminder();
        });

        document.querySelectorAll('[data-role]').forEach(button => {
            button.addEventListener('click', () => applyRole(button.dataset.role, true));
        });

        document.querySelectorAll('[data-focus-target]').forEach(button => {
            button.addEventListener('click', () => {
                const target = document.querySelector(button.dataset.focusTarget);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function applyRole(roleKey, shouldScroll) {
        const role = roles[roleKey] || roles.self;
        document.querySelectorAll('[data-role]').forEach(button => {
            const isActive = button.dataset.role === roleKey;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });

        els.roleLabel.textContent = role.label;
        els.roleSummary.textContent = role.summary;
        els.composeTip.textContent = role.tip;
        els.captionHintPrimary.textContent = role.hints[0];
        els.captionHintSecondary.textContent = role.hints[1];
        els.displayText.textContent = role.display;
        if (!els.sayText.value.trim()) {
            els.sayText.value = role.draft;
            updateSayCount();
        }
        if (shouldScroll) {
            toast(role.summary);
            document.querySelector('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function prepareRoleDraft() {
        const active = document.querySelector('[data-role].active');
        const role = roles[active?.dataset.role] || roles.self;
        els.sayText.value = role.draft;
        updateSayCount();
        showLarge(role.display);
    }

    function updateSayCount() {
        els.sayCount.textContent = String(els.sayText.value.length);
    }

    function setupRecognition() {
        state.recognition = new SpeechRecognition();
        state.recognition.lang = 'zh-CN';
        state.recognition.continuous = true;
        state.recognition.interimResults = true;
        state.recognition.maxAlternatives = 1;

        state.recognition.onstart = () => {
            state.listening = true;
            setMicState(true);
        };

        state.recognition.onresult = event => {
            let interim = '';

            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                const text = result[0].transcript.trim();
                if (!text) continue;

                if (result.isFinal) {
                    addTranscript(text, '已确认');
                } else {
                    interim = text;
                }
            }

            renderTranscript(interim);
        };

        state.recognition.onerror = event => {
            toast(`语音识别暂时不可用：${event.error || '未知错误'}`);
            setMicState(false);
        };

        state.recognition.onend = () => {
            state.listening = false;
            setMicState(false);
        };
    }

    function startListening() {
        if (!state.recognition || state.listening) return;
        try {
            state.recognition.start();
            toast('开始收音。请靠近说话者，尽量一次说短句。');
        } catch (error) {
            toast('无法启动收音，请稍后重试。');
        }
    }

    function stopListening() {
        if (!state.recognition || !state.listening) return;
        state.recognition.stop();
        setMicState(false);
        toast('已停止收音。');
    }

    function setMicState(isListening) {
        els.stopCaption.disabled = !isListening;
        els.startCaption.disabled = isListening || !supportsRecognition;
        els.micState.textContent = isListening ? '收音中' : '未开启';
        els.micState.classList.toggle('listening', isListening);
    }

    function addTranscript(text, source) {
        const last = state.transcript[state.transcript.length - 1];
        if (last && last.text === text) return;

        state.transcript.push({
            text,
            source,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        });
        state.transcript = state.transcript.slice(-8);
        renderTranscript('');
    }

    function renderTranscript(interim) {
        if (!state.transcript.length && !interim) {
            els.captionDisplay.innerHTML = '<p class="placeholder">点击“开始收音”后，对方讲话会尽量转成这里的大字字幕。识别不准时，可以请对方放慢、重复，或切到打字沟通。</p>';
            return;
        }

        const confirmed = state.transcript.map(item => `
            <p class="caption-line">${escapeHtml(item.text)}<small>${escapeHtml(item.time)} · ${escapeHtml(item.source)}</small></p>
        `).join('');
        const current = interim
            ? `<p class="caption-line">${escapeHtml(interim)}<small>正在识别...</small></p>`
            : '';

        els.captionDisplay.innerHTML = confirmed + current;
        els.captionDisplay.scrollTop = els.captionDisplay.scrollHeight;
    }

    async function copyTranscript() {
        const text = state.transcript.map(item => `${item.time} ${item.text}`).join('\n');
        if (!text) {
            toast('还没有可复制的字幕。');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            toast('字幕已复制。');
        } catch (error) {
            toast('复制失败，请手动选择字幕。');
        }
    }

    function clearTranscript() {
        state.transcript = [];
        renderTranscript('');
        toast('字幕已清空。');
    }

    function speak(text) {
        if (!text) {
            toast('请先输入或选择一句话。');
            return;
        }
        if (!supportsSpeech) {
            toast('当前浏览器不支持朗读。');
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.92;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
        toast('正在朗读给对方听。');
    }

    function showLarge(text) {
        if (!text) {
            toast('请先输入一句要给对方看的话。');
            return;
        }
        els.displayText.textContent = text;
        document.getElementById('displayCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function renderPhrases() {
        els.phraseGrid.innerHTML = phrases.map((phrase, index) => `
            <button class="phrase-card ${phrase.emergency ? 'emergency' : ''}" type="button" data-phrase-index="${index}">
                <strong>${escapeHtml(phrase.title)}</strong>
                <span>${escapeHtml(phrase.text)}</span>
            </button>
        `).join('');

        els.phraseGrid.querySelectorAll('[data-phrase-index]').forEach(card => {
            card.addEventListener('click', () => {
                const phrase = phrases[Number(card.dataset.phraseIndex)];
                els.sayText.value = phrase.text;
                showLarge(phrase.text);
                if (phrase.emergency) vibrate([200, 90, 200, 90, 320]);
            });
        });
    }

    function addReminder() {
        const text = els.reminderText.value.trim();
        if (!text) {
            toast('请输入提醒内容。');
            return;
        }

        state.reminders.unshift({
            id: Date.now().toString(36),
            text,
            createdAt: new Date().toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
        });
        state.reminders = state.reminders.slice(0, 8);
        els.reminderText.value = '';
        saveReminders();
        renderReminders();
        vibrate([140, 70, 140]);
        toast('提醒已保存在本机。');
    }

    function renderReminders() {
        if (!state.reminders.length) {
            els.reminderList.innerHTML = '<li><span>还没有本地提醒。可添加“吃药”“开会”“出门”等。</span></li>';
            return;
        }

        els.reminderList.innerHTML = state.reminders.map(item => `
            <li>
                <span>${escapeHtml(item.text)} · ${escapeHtml(item.createdAt)}</span>
                <button type="button" data-remove-reminder="${escapeHtml(item.id)}">删除</button>
            </li>
        `).join('');

        els.reminderList.querySelectorAll('[data-remove-reminder]').forEach(button => {
            button.addEventListener('click', () => {
                state.reminders = state.reminders.filter(item => item.id !== button.dataset.removeReminder);
                saveReminders();
                renderReminders();
            });
        });
    }

    function clearReminders() {
        state.reminders = [];
        saveReminders();
        renderReminders();
        toast('本地提醒已清空。');
    }

    function vibrate(pattern) {
        if (!supportsVibration) {
            toast('当前设备不支持网页震动。');
            return;
        }
        navigator.vibrate(pattern);
    }

    function loadReminders() {
        try {
            const raw = localStorage.getItem('hearbridge_reminders_v1');
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function saveReminders() {
        localStorage.setItem('hearbridge_reminders_v1', JSON.stringify(state.reminders));
    }

    let toastTimer = null;
    function toast(message) {
        window.clearTimeout(toastTimer);
        els.toast.textContent = message;
        els.toast.classList.add('show');
        toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2800);
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
