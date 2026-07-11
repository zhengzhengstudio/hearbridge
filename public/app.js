(function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const supportsRecognition = Boolean(SpeechRecognition);
    const supportsSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const supportsVibration = 'vibrate' in navigator;
    const supportsLocalRecording = Boolean(
        navigator.mediaDevices?.getUserMedia && window.MediaRecorder
    );

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
        recorder: null,
        mediaStream: null,
        audioChunks: [],
        listening: false,
        recording: false,
        recordingMode: 'sample',
        asrConfigured: false,
        asrChecked: false,
        transcript: [],
        recordings: [],
        reminders: [],
        hotwords: []
    };

    const els = {
        recognitionStatus: document.getElementById('recognitionStatus'),
        vibrationStatus: document.getElementById('vibrationStatus'),
        micState: document.getElementById('micState'),
        captionDisplay: document.getElementById('captionDisplay'),
        recordFallback: document.getElementById('recordFallback'),
        recordFallbackText: document.getElementById('recordFallbackText'),
        asrState: document.getElementById('asrState'),
        manualCaption: document.getElementById('manualCaption'),
        addManualCaption: document.getElementById('addManualCaption'),
        saveHotword: document.getElementById('saveHotword'),
        hotwordGrid: document.getElementById('hotwordGrid'),
        startTranscribeRecord: document.getElementById('startTranscribeRecord'),
        startRecord: document.getElementById('startRecord'),
        stopRecord: document.getElementById('stopRecord'),
        recordingList: document.getElementById('recordingList'),
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

    async function init() {
        await loadBackendState();
        renderCapabilities();
        applyRole('self', false);
        renderPhrases();
        renderReminders();
        renderHotwords();
        bindEvents();
        if (supportsRecognition) setupRecognition();
        checkServerStatus();
    }

    async function loadBackendState() {
        try {
            const res = await HearAuth.apiFetch('/api/data', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            state.reminders = Array.isArray(data.reminders) ? data.reminders : [];
            state.hotwords = Array.isArray(data.hotwords) ? data.hotwords : [];
            state.recordings = Array.isArray(data.samples) ? data.samples.filter(s => s.type && s.type.includes('recording')) : [];
            state.transcript = Array.isArray(data.transcript) ? data.transcript : [];
        } catch (err) {
            console.warn('[HearBridge] 加载后端状态失败:', err.message);
        }
    }

    function renderCapabilities() {
        if (supportsRecognition) {
            els.recognitionStatus.textContent = '当前浏览器支持语音识别。识别质量会受方言、口罩、距离和网络影响。';
        } else {
            els.recognitionStatus.textContent = '当前浏览器不支持实时语音识别；可以使用打字发声、常用语、本地录音和提醒。';
            els.startCaption.disabled = true;
            showRecordingFallback('当前浏览器没有实时字幕能力，可以先用本地录音保存训练样本。');
        }

        if (!supportsLocalRecording) {
            els.startTranscribeRecord.disabled = true;
            els.startRecord.disabled = true;
            els.recordFallbackText.textContent = '当前浏览器不支持网页录音；仍可使用打字、常用语和大字卡片。';
        } else {
            setAsrMode(false, '本地模式');
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
        els.startTranscribeRecord.addEventListener('click', () => startLocalRecording('transcribe'));
        els.startRecord.addEventListener('click', () => startLocalRecording('sample'));
        els.stopRecord.addEventListener('click', stopLocalRecording);
        els.addManualCaption.addEventListener('click', addManualCaption);
        els.saveHotword.addEventListener('click', saveManualHotword);
        els.roleAction.addEventListener('click', prepareRoleDraft);
        els.sayText.addEventListener('input', updateSayCount);

        els.reminderText.addEventListener('keydown', event => {
            if (event.key === 'Enter') addReminder();
        });

        els.manualCaption.addEventListener('keydown', event => {
            if (event.key === 'Enter') addManualCaption();
        });

        document.querySelectorAll('[data-role]').forEach(button => {
            button.addEventListener('click', () => applyRole(button.dataset.role, true));
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
            handleRecognitionError(event.error);
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

    function handleRecognitionError(errorCode) {
        if (errorCode === 'network') {
            const message = '实时识别服务网络失败：这通常是浏览器的在线转写服务连不上，不是麦克风坏了。';
            els.recognitionStatus.textContent = `${message} 已开启本地录音备用。`;
            showRecordingFallback(state.asrConfigured
                ? '浏览器识别连不上，可以改用“录音转文字”或手动补字幕。'
                : '无 API key 模式：请用“只保存样本”、手动补字幕和本地热词训练继续沟通。');
            addTranscript(state.asrConfigured
                ? '浏览器识别网络失败。可以改用录音转文字、打字或常用语卡片继续沟通。'
                : '识别服务网络失败。当前为无 API key 本地模式，请改用手动字幕、只保存样本或常用语卡片。', '系统提示');
            toast(state.asrConfigured
                ? '识别失败：network。可改用录音转文字。'
                : '识别失败：network。已切换本地模式。');
            return;
        }

        if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
            els.recognitionStatus.textContent = '麦克风权限被拒绝。请允许浏览器使用麦克风，或改用打字和常用语。';
            toast('麦克风权限未开启。');
            return;
        }

        toast(`语音识别暂时不可用：${errorCode || '未知错误'}`);
    }

    function setMicState(isListening) {
        els.stopCaption.disabled = !isListening;
        els.startCaption.disabled = isListening || !supportsRecognition;
        els.micState.textContent = isListening ? '收音中' : '未开启';
        els.micState.classList.toggle('listening', isListening);
    }

    function showRecordingFallback(message) {
        els.recordFallback.hidden = false;
        if (message) els.recordFallbackText.textContent = message;
        renderHotwords();
        renderRecordings();
    }

    async function startLocalRecording(mode) {
        if (!supportsLocalRecording || state.recording) return;
        if (mode === 'transcribe' && !state.asrConfigured) {
            showRecordingFallback('没有 API key 时不能云端转写；请先“只保存样本”，或让对方帮忙打字补一句字幕。');
            toast('无 API key，已为你保留本地训练入口。');
            return;
        }

        try {
            state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            state.audioChunks = [];
            state.recordingMode = mode === 'transcribe' ? 'transcribe' : 'sample';
            state.recorder = new MediaRecorder(state.mediaStream);

            state.recorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) state.audioChunks.push(event.data);
            });

            state.recorder.addEventListener('stop', saveLocalRecording);
            state.recorder.start();
            state.recording = true;
            els.startTranscribeRecord.disabled = true;
            els.startRecord.disabled = true;
            els.stopRecord.disabled = false;
            els.micState.textContent = '录音中';
            els.micState.classList.add('listening');
            toast(state.recordingMode === 'transcribe'
                ? '正在录音。停止后会上传到服务端转文字。'
                : '正在本地录音。说完后点“停止录音”。');
        } catch (error) {
            toast('无法打开麦克风。请检查浏览器权限。');
        }
    }

    function stopLocalRecording() {
        if (!state.recorder || !state.recording) return;
        state.recorder.stop();
    }

    function saveLocalRecording() {
        const blob = new Blob(state.audioChunks, { type: state.recorder?.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const createdAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const mode = state.recordingMode;

        state.recordings.unshift({
            id: Date.now().toString(36),
            type: 'recording',
            url,
            createdAt,
            size: blob.size
        });
        state.recordings = state.recordings.slice(0, 5);
        state.recording = false;
        state.recordingMode = 'sample';
        state.recorder = null;
        state.audioChunks = [];
        stopMediaStream();
        els.startTranscribeRecord.disabled = !supportsLocalRecording || !state.asrConfigured;
        els.startRecord.disabled = !supportsLocalRecording;
        els.stopRecord.disabled = true;
        els.micState.textContent = '未开启';
        els.micState.classList.remove('listening');
        persistBackendState();
        renderRecordings();

        if (mode === 'transcribe') {
            transcribeRecording(blob);
            return;
        }

        addTranscript('已保存一段本地录音样本，可用于之后整理个人热词和错词。', '本地录音');
        toast('录音样本已保存。');
    }

    function stopMediaStream() {
        if (!state.mediaStream) return;
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }

    function renderRecordings() {
        if (!state.recordings.length) {
            els.recordingList.innerHTML = '<li>还没有录音样本。遇到 network 时，可以先录一段保留训练材料。</li>';
            return;
        }

        els.recordingList.innerHTML = state.recordings.map((recording, index) => `
            <li>
                <span>样本 ${state.recordings.length - index} · ${escapeHtml(recording.createdAt)} · ${formatBytes(recording.size)}</span>
                <audio controls src="${recording.url}"></audio>
            </li>
        `).join('');
    }

    async function transcribeRecording(blob) {
        if (!blob.size) {
            toast('录音太短，没有可转写内容。');
            return;
        }

        els.startTranscribeRecord.disabled = true;
        els.startRecord.disabled = true;
        els.recordFallbackText.textContent = '正在上传录音并转文字；录音只用于本次转写，不在声桥服务器保存。';
        toast('正在转文字...');

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                headers: {
                    'Content-Type': blob.type || 'audio/webm'
                },
                body: blob
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                if (payload.error === 'asr_not_configured') {
                    addTranscript('云端转写还没有配置。录音样本已保留，可继续使用打字或常用语。', '系统提示');
                    toast('云端转写未配置，录音样本已保留。');
                    return;
                }
                toast(payload.message || '转写失败，请稍后重试。');
                return;
            }

            const text = String(payload.text || '').trim();
            if (!text) {
                toast('没有识别到清晰文字，请靠近说话者重录。');
                return;
            }

            addTranscript(text, '云端转写');
            showLarge(text);
            toast('已转成文字。');
        } catch (error) {
            toast('转写请求失败，请检查网络或改用打字。');
        } finally {
            els.startTranscribeRecord.disabled = !supportsLocalRecording || !state.asrConfigured;
            els.startRecord.disabled = !supportsLocalRecording;
            els.recordFallbackText.textContent = state.asrConfigured
                ? '识别服务连不上时，可以录音转文字；也可以只保存样本。'
                : '无 API key 模式：样本只保存在当前页面内，可配合手动字幕和热词训练继续使用。';
        }
    }

    async function checkServerStatus() {
        try {
            const response = await fetch('/api/status', { cache: 'no-store' });
            const status = await response.json();
            setAsrMode(status.asr === 'configured', status.asr === 'configured' ? '可转写' : '本地模式');
        } catch (error) {
            setAsrMode(false, '本地模式');
        } finally {
            state.asrChecked = true;
        }
    }

    function setAsrMode(isConfigured, label) {
        state.asrConfigured = Boolean(isConfigured);
        els.asrState.textContent = label || (state.asrConfigured ? '可转写' : '本地模式');
        els.asrState.classList.toggle('ready', state.asrConfigured);
        els.startTranscribeRecord.disabled = !supportsLocalRecording || !state.asrConfigured;
        els.startTranscribeRecord.textContent = state.asrConfigured ? '录音转文字' : '无 API：本地训练';
        if (!state.asrConfigured) {
            els.recordFallbackText.textContent = '无 API key 模式：录音不会上传；可保存样本、手动补字幕、沉淀热词，后续接入本地或云端识别。';
        }
    }

    function addManualCaption() {
        const text = els.manualCaption.value.trim();
        if (!text) {
            toast('请输入一句要加入字幕的内容。');
            return;
        }
        addTranscript(text, '手动补充');
        showLarge(text);
        els.manualCaption.value = '';
        toast('已加入字幕和大字卡。');
    }

    function saveManualHotword() {
        const text = els.manualCaption.value.trim() || els.sayText.value.trim();
        if (!text) {
            toast('先输入一个姓名、药名、地点或常用短句。');
            return;
        }
        addHotword(text);
    }

    function addHotword(text) {
        const value = text.trim().slice(0, 40);
        if (!value) return;
        state.hotwords = [value, ...state.hotwords.filter(item => item !== value)].slice(0, 12);
        persistBackendState();
        renderHotwords();
        toast('已加入后端训练词库。');
    }

    function renderHotwords() {
        if (!state.hotwords.length) {
            els.hotwordGrid.innerHTML = '<span class="empty-hotword">还没有热词</span>';
            return;
        }
        els.hotwordGrid.innerHTML = state.hotwords.map(item => `
            <button class="hotword-chip" type="button" data-hotword="${escapeHtml(item)}">${escapeHtml(item)}</button>
        `).join('');
        els.hotwordGrid.querySelectorAll('[data-hotword]').forEach(button => {
            button.addEventListener('click', () => {
                els.manualCaption.value = button.dataset.hotword;
                toast('已填入，可加入字幕或继续编辑。');
            });
        });
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

        // 优先尝试云端 TTS，音质更好
        speakCloudTts(text).catch(error => {
            console.warn('[HearBridge] 云端朗读失败，回退本地:', error.message);
            speakLocal(text);
        });
        toast('正在朗读给对方听。');
    }

    async function speakCloudTts(text) {
        const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.slice(0, 500), voice: 'shimmer', speed: '0.95' })
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload.message || '云端朗读失败');
        }
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
    }

    function speakLocal(text) {
        if (!supportsSpeech) {
            toast('当前浏览器不支持朗读。');
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.92;
        utterance.pitch = 1.05;
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang === 'zh-CN' && /Zhiyu|Ting-Ting|Mei-Jia|Yaoyao|yating|hsiaochen|hsiaoyao|yunxi|yunjian|xiaoxiao/i.test(v.name));
        if (preferred) utterance.voice = preferred;
        window.speechSynthesis.speak(utterance);
    }

    if (supportsSpeech && window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
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
        persistBackendState();
        renderReminders();
        vibrate([140, 70, 140]);
        toast('提醒已保存。');
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
                persistBackendState();
                renderReminders();
            });
        });
    }

    function clearReminders() {
        state.reminders = [];
        persistBackendState();
        renderReminders();
        toast('提醒已清空。');
    }

    function vibrate(pattern) {
        if (!supportsVibration) {
            toast('当前设备不支持网页震动。');
            return;
        }
        navigator.vibrate(pattern);
    }

    function loadReminders() {
        return [];
    }

    function saveReminders() {
        // 已迁移到后端 /api/data，无需保留本地存储
    }

    function loadHotwords() {
        return [];
    }

    function saveHotwords() {
        // 已迁移到后端 /api/data，无需保留本地存储
    }

    async function persistBackendState() {
        try {
            await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reminders: state.reminders,
                    hotwords: state.hotwords,
                    samples: state.recordings,
                    transcript: state.transcript
                })
            });
        } catch (err) {
            console.warn('[HearBridge] 保存后端状态失败:', err.message);
        }
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

    function formatBytes(value) {
        if (!Number.isFinite(value) || value <= 0) return '0 KB';
        return `${Math.max(1, Math.round(value / 1024))} KB`;
    }
})();
