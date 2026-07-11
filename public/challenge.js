(function () {
    const categories = {
        daily: { label: '日常', color: 'cat-daily' },
        traffic: { label: '交通', color: 'cat-traffic' },
        shopping: { label: '购物', color: 'cat-shopping' },
        dining: { label: '餐饮', color: 'cat-dining' },
        medical: { label: '医疗', color: 'cat-medical' },
        service: { label: '服务', color: 'cat-service' },
        emergency: { label: '紧急', color: 'cat-emergency' }
    };

    const missions = [
        { id: 'm1', category: 'daily', title: '早上遇到邻居打招呼', desc: '早上出门遇到邻居阿姨，你听不见她说什么，但想礼貌回应。', speaker: '邻居阿姨', otherText: '上班去啊？', question: '你会怎么打招呼回应？', hint: '可以说“阿姨早”“上班去”“您好”等。', answers: ['阿姨早', '上班去', '您好', '早', '早上好'], sentence: '阿姨早，您去上班啊？' },
        { id: 'm2', category: 'traffic', title: '路口询问红绿灯', desc: '你站在路口，听不见红绿灯提示音，不确定能不能过马路。', speaker: '路人', otherText: '（站在路口）', question: '你会怎么请路人或同伴确认灯？', hint: '可以说“请问现在是绿灯吗”“可以过马路吗”“帮我看看灯”等。', answers: ['请问现在是绿灯吗', '可以过马路吗', '帮我看看灯', '现在是绿灯吗', '能过吗'], sentence: '请问现在是绿灯吗？我可以过马路吗？' },
        { id: 'm3', category: 'shopping', title: '超市询问商品价格', desc: '超市里促销员在介绍优惠，你听不清具体价格。', speaker: '促销员', otherText: '这个今天特价。', question: '你会怎么请店员把价格写给你或指给你看？', hint: '可以说“写一下价格”“指给我看”“多少钱”等。', answers: ['写一下价格', '指给我看', '多少钱', '价格写给我', '写给我'], sentence: '您好，请问这串葡萄多少钱？' },
        { id: 'm4', category: 'dining', title: '快餐店点餐', desc: '你在快餐店柜台前，听不清店员问你堂食还是外带。', speaker: '店员', otherText: '堂食还是外带？', question: '你会怎么回答并说明听力不好？', hint: '可以说“我要堂食”“外带”“我听不清”“请写给我”等。', answers: ['我要堂食', '外带', '我听不清', '请写给我', '带走'], sentence: '您好，我要一份套餐，麻烦写给我看。' },
        { id: 'm5', category: 'medical', title: '医院挂号', desc: '你去医院，听不清挂号窗口问你有没有预约。', speaker: '挂号员', otherText: '有预约吗？', question: '你会怎么说明情况并挂号？', hint: '可以说“我听力不好”“请写给我”“挂内科”“我没预约”等。', answers: ['我听力不好', '请写给我', '挂内科', '我没预约', '帮我挂号'], sentence: '您好，我头痛，请帮我挂内科。' },
        { id: 'm6', category: 'service', title: '银行取号排队', desc: '银行柜员跟你说话，你听不清要办什么业务。', speaker: '柜员', otherText: '您要办什么业务？', question: '你会怎么请柜员把关键信息写给你？', hint: '可以说“请写给我”“用纸笔沟通”“我听不清”等。', answers: ['请写给我', '用纸笔沟通', '我听不清', '写一下', '写下来'], sentence: '您好，我想取钱，麻烦帮我取个号。' },
        { id: 'm7', category: 'traffic', title: '打车说明目的地', desc: '你打到网约车，司机打电话确认位置，你听不清。', speaker: '司机', otherText: '您在哪个位置？', question: '你会怎么让司机通过文字或定位找到你？', hint: '可以说“我看定位”“发位置给你”“我听不清”等。', answers: ['我看定位', '发位置给你', '我听不清', '按定位来', '文字说'], sentence: '师傅您好，我要去火车站。' },
        { id: 'm8', category: 'shopping', title: '便利店扫码付款', desc: '店员问你要现金还是扫码，你听不清。', speaker: '店员', otherText: '现金还是扫码？', question: '你会怎么回答并说明听力情况？', hint: '可以说“扫码”“我扫码”“我听不清”“请写给我”等。', answers: ['扫码', '我扫码', '我听不清', '请写给我', '手机付'], sentence: '您好，我扫码付款可以吗？' },
        { id: 'm9', category: 'daily', title: '请求别人重复', desc: '别人跟你说了一句话，你只听到一半。', speaker: '同事', otherText: '下午三点开会。', question: '你会怎么请对方再说一遍或写下来？', hint: '可以说“请再说一遍”“我没听清”“麻烦写给我”等。', answers: ['请再说一遍', '我没听清', '麻烦写给我', '再说一次', '没听清'], sentence: '不好意思，我没听清，麻烦您再说一遍可以吗？' },
        { id: 'm10', category: 'emergency', title: '身体不适求助', desc: '你在街上突然头晕，需要急救，但自己打电话说不清。', speaker: '路人', otherText: '您怎么了？', question: '你会怎么请路人帮你打120并说明你听不见？', hint: '可以说“帮我打120”“我身体不舒服”“我听不见”等。', answers: ['帮我打120', '我身体不舒服', '我听不见', '叫救护车', '头晕'], sentence: '保安您好，我不舒服，麻烦您帮我叫一下120。' },
        { id: 'm11', category: 'dining', title: '餐馆打包剩菜', desc: '吃完饭你想打包，听不清服务员问要不要发票。', speaker: '服务员', otherText: '需要发票吗？', question: '你会怎么回应并打包？', hint: '可以说“打包带走”“不要发票”“请写给我”“帮我把剩菜打包”等。', answers: ['打包带走', '不要发票', '请写给我', '帮我把剩菜打包', '带走'], sentence: '好的，麻烦帮我把剩菜打包带走。' },
        { id: 'm12', category: 'medical', title: '药店买药', desc: '你去药店，听不清药师问你要什么药。', speaker: '药师', otherText: '您要什么药？', question: '你会怎么说明症状并请求写字？', hint: '可以说“我感冒了”“想买感冒药”“请写给我”“我听不清”等。', answers: ['我感冒了', '想买感冒药', '请写给我', '我听不清', '买感冒药'], sentence: '您好，我感冒了，想买一盒感冒药。' },
        { id: 'm13', category: 'service', title: '复印证件', desc: '你去复印店，听不清店员问你要复印几份。', speaker: '店员', otherText: '复印几份？', question: '你会怎么回答并说明听力情况？', hint: '可以说“复印一份”“请写给我”“我听不清”等。', answers: ['复印一份', '请写给我', '我听不清', '一份', '帮我复印'], sentence: '您好，我要复印身份证。' },
        { id: 'm14', category: 'traffic', title: '询问公交站点', desc: '你在公交站，听不清报站，不知道哪站下车。', speaker: '同车乘客', otherText: '马上到站了。', question: '你会怎么请乘客提醒你下车？', hint: '可以说“请问在哪下车”“到XX站叫我”“帮我看站”等。', answers: ['请问在哪下车', '到站叫我', '帮我看站', '在哪一站', '提醒我'], sentence: '您好，请问去图书馆应该在哪一站下车？' },
        { id: 'm15', category: 'shopping', title: '询问尺码', desc: '你想试衣服，听不清店员问你要什么码。', speaker: '店员', otherText: '您穿什么码？', question: '你会怎么请店员拿大一码并说明听力情况？', hint: '可以说“有大一码吗”“请写给我”“我听不清”等。', answers: ['有大一码吗', '请写给我', '我听不清', '大一码', '试穿'], sentence: '您好，我想试穿这件外套，请问有大一码的吗？' },
        { id: 'm16', category: 'daily', title: '表达感谢', desc: '别人帮你把快递放到前台，你想表示感谢。', speaker: '同事', otherText: '快递放前台了。', question: '你会怎么表达感谢？', hint: '可以说“太感谢了”“麻烦你了”“谢谢”等。', answers: ['太感谢了', '麻烦你了', '谢谢', '多谢', '感谢'], sentence: '太感谢您了，麻烦您帮我收快递。' },
        { id: 'm17', category: 'emergency', title: '火警逃生提醒', desc: '你发现楼道里有烟味，需要提醒旁边的人快走。', speaker: '同事', otherText: '怎么了？', question: '你会怎么简短有力地提醒对方？', hint: '可以说“快跑”“有危险”“走楼梯”“着火了”等。', answers: ['快跑', '有危险', '走楼梯', '着火了', '快下去'], sentence: '快跑，有危险了，我们走楼梯下去！' },
        { id: 'm18', category: 'dining', title: '咖啡店点单', desc: '咖啡店店员问你喝什么，你听不清。', speaker: '店员', otherText: '您喝点什么？', question: '你会怎么点单并说明听力情况？', hint: '可以说“我要一杯美式”“请写给我”“我听不清”等。', answers: ['我要一杯美式', '请写给我', '我听不清', '一杯美式', '咖啡'], sentence: '您好，我要一杯美式咖啡。' },
        { id: 'm19', category: 'medical', title: '预约复诊', desc: '你需要预约复诊时间，听不清工作人员说的日期。', speaker: '工作人员', otherText: '下周三可以吗？', question: '你会怎么请对方把预约信息写给你？', hint: '可以说“请写给我”“我听不清”“帮我预约”“下周三可以”等。', answers: ['请写给我', '我听不清', '帮我预约', '下周三可以', '预约'], sentence: '您好，我想预约一下复诊时间。' },
        { id: 'm20', category: 'service', title: '办理身份证', desc: '你去政务大厅办身份证，听不清工作人员要什么材料。', speaker: '工作人员', otherText: '带身份证照片了吗？', question: '你会怎么请对方写清单给你？', hint: '可以说“请写给我”“我听不清”“要哪些材料”“帮我列一下”等。', answers: ['请写给我', '我听不清', '要哪些材料', '帮我列一下', '材料清单'], sentence: '您好，我要办理身份证，我的身份证到期了。' }
    ];

    const levels = [
        { id: 'hospital-mask', title: '医院口罩沟通', category: 'medical', scene: '医生戴着口罩，说话很快。你需要拿到诊断、药量和注意事项。', goal: '先说明听障，再请医生写下诊断、药量和注意事项。', suggested: '医生您好，我听力不好，麻烦您把诊断、药量和注意事项写给我。' },
        { id: 'metro-wayfinding', title: '地铁问路', category: 'traffic', scene: '站台很吵，你要确认换乘方向和站名。', goal: '请工作人员用文字告诉你路线。', suggested: '您好，我听不清广播，麻烦把换乘路线写给我。' },
        { id: 'work-confirm', title: '工作确认', category: 'daily', scene: '同事口头交代了一个复杂任务，你担心漏掉时间和下一步。', goal: '请同事把口头任务转成文字确认。', suggested: '麻烦把任务时间和下一步写给我，我怕听漏。' },
        { id: 'shopping-service', title: '购物服务', category: 'shopping', scene: '店员解释价格、规格和取货方式，你需要避免听错。', goal: '请店员写清金额、规格和取货方式。', suggested: '请把金额、规格和取货方式写给我，谢谢。' },
        { id: 'emergency-help', title: '紧急求助', category: 'emergency', scene: '周围有人喊话，但你听不清发生了什么，需要快速求助。', goal: '说明不要只用语音呼喊，请对方用文字或联系工作人员。', suggested: '我听不清，请用文字或帮我找工作人员。' }
    ];

    const allScenarios = [...levels, ...missions];

    const state = {
        active: null,
        mode: 'practice',
        xp: 0,
        streak: 0,
        completed: [],
        collected: [],
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
        asrConfigured: false,
        playMode: 'ai'
    };

    const supportsLocalRecording = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

    const els = {
        introSection: document.getElementById('introSection'),
        setupSection: document.getElementById('setupSection'),
        gameSection: document.getElementById('gameSection'),
        resultSection: document.getElementById('resultSection'),
        levelList: document.getElementById('levelList'),
        xpValue: document.getElementById('xpValue'),
        streakValue: document.getElementById('streakValue'),
        collectedValue: document.getElementById('collectedValue'),
        levelTitle: document.getElementById('levelTitle'),
        levelGoal: document.getElementById('levelGoal'),
        scenarioRole: document.getElementById('scenarioRole'),
        scenarioText: document.getElementById('scenarioText'),
        scenarioBox: document.getElementById('scenarioBox'),
        suggestedBar: document.getElementById('suggestedBar'),
        modeSelector: document.getElementById('modeSelector'),
        playModeTabs: document.getElementById('playModeTabs'),
        startMission: document.getElementById('startMission'),
        gameLevelTitle: document.getElementById('gameLevelTitle'),
        gameLevelGoal: document.getElementById('gameLevelGoal'),
        gameScenario: document.getElementById('gameScenario'),
        roundBadge: document.getElementById('roundBadge'),
        modeBadge: document.getElementById('modeBadge'),
        chatBox: document.getElementById('chatBox'),
        answerBox: document.getElementById('answerBox'),
        answerModeBox: document.getElementById('answerModeBox'),
        answerText: document.getElementById('answerText'),
        answerQuestion: document.getElementById('answerQuestion'),
        answerHint: document.getElementById('answerHint'),
        answerOptions: document.getElementById('answerOptions'),
        answerInput: document.getElementById('answerInput'),
        completeLevel: document.getElementById('completeLevel'),
        recordAnswer: document.getElementById('recordAnswer'),
        useSuggested: document.getElementById('useSuggested'),
        hintButton: document.getElementById('hintButton'),
        giveUpButton: document.getElementById('giveUpButton'),
        submitAnswer: document.getElementById('submitAnswer'),
        recordAnswerMode: document.getElementById('recordAnswerMode'),
        feedback: document.getElementById('feedback'),
        resultTitle: document.getElementById('resultTitle'),
        resultSummary: document.getElementById('resultSummary'),
        scoreClarity: document.getElementById('scoreClarity'),
        scoreStrategy: document.getElementById('scoreStrategy'),
        scoreCompletion: document.getElementById('scoreCompletion'),
        reviewList: document.getElementById('reviewList'),
        cardReward: document.getElementById('cardReward'),
        cardRewardText: document.getElementById('cardRewardText'),
        replayLevel: document.getElementById('replayLevel'),
        backToSetup: document.getElementById('backToSetup'),
        toast: document.getElementById('toast'),
        robotMascot: document.getElementById('robotMascot'),
        robotBubble: document.getElementById('robotBubble')
    };

    init();

    async function init() {
        bind();
        await loadBackendState();
        renderLevelList();
        selectLevelOnSetup(allScenarios[0].id);
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
            state.streak = Number(data.streak) || 0;
            state.completed = Array.isArray(data.completedLevels) ? data.completedLevels : [];
            state.collected = Array.isArray(data.collectedCards) ? data.collectedCards : [];
            updateStats();
        } catch (err) {
            console.warn('[HearBridge] 加载后端状态失败:', err.message);
        }
    }

    async function saveBackendState() {
        try {
            await HearAuth.apiFetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ xp: state.xp, streak: state.streak, completedLevels: state.completed, collectedCards: state.collected })
            });
        } catch (err) {
            console.warn('[HearBridge] 保存后端状态失败:', err.message);
        }
    }

    function updateStats() {
        els.xpValue.textContent = String(state.xp);
        els.streakValue.textContent = String(state.streak);
        els.collectedValue.textContent = String(state.collected.length);
    }

    function bind() {
        els.levelList.addEventListener('click', handleLevelListClick);
        els.modeSelector.addEventListener('click', handleModeClick);
        els.playModeTabs.addEventListener('click', handlePlayModeClick);
        els.startMission.addEventListener('click', () => {
            if (!state.active) return;
            startGame(state.active.id, state.mode);
        });
        els.completeLevel.addEventListener('click', sendPlayerMessage);
        els.useSuggested.addEventListener('click', useSuggested);
        els.hintButton.addEventListener('click', showHint);
        els.giveUpButton.addEventListener('click', endGameSession);
        els.submitAnswer.addEventListener('click', submitStandardAnswer);
        els.replayLevel.addEventListener('click', () => startGame(state.active.id, state.mode));
        els.backToSetup.addEventListener('click', showSetup);
        if (els.recordAnswer) {
            els.recordAnswer.addEventListener('mousedown', startRecording);
            els.recordAnswer.addEventListener('touchstart', startRecording);
            els.recordAnswer.addEventListener('mouseup', stopRecording);
            els.recordAnswer.addEventListener('mouseleave', stopRecording);
            els.recordAnswer.addEventListener('touchend', stopRecording);
        }
        if (els.recordAnswerMode) {
            els.recordAnswerMode.addEventListener('mousedown', startRecording);
            els.recordAnswerMode.addEventListener('touchstart', startRecording);
            els.recordAnswerMode.addEventListener('mouseup', stopRecording);
            els.recordAnswerMode.addEventListener('mouseleave', stopRecording);
            els.recordAnswerMode.addEventListener('touchend', stopRecording);
        }
        els.answerText.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendPlayerMessage();
            }
        });
        els.answerInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitStandardAnswer();
            }
        });
        els.robotMascot.addEventListener('click', () => showRobot('每过一关都能收集一句常用语，多去训练页复习哦！'));
    }

    function handleLevelListClick(event) {
        const card = event.target.closest('[data-level]');
        if (!card) return;
        selectLevelOnSetup(card.dataset.level);
    }

    function handleModeClick(event) {
        const card = event.target.closest('[data-mode]');
        if (!card) return;
        document.querySelectorAll('#modeSelector .mode-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        state.mode = card.dataset.mode;
    }

    function handlePlayModeClick(event) {
        const tab = event.target.closest('[data-play]');
        if (!tab) return;
        document.querySelectorAll('#playModeTabs .play-mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.playMode = tab.dataset.play;
    }

    function renderLevelList() {
        updateStats();
        const grouped = {};
        for (const s of allScenarios) {
            const cat = s.category || 'daily';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(s);
        }
        const catOrder = ['daily', 'traffic', 'shopping', 'dining', 'medical', 'service', 'emergency'];
        els.levelList.innerHTML = catOrder.map(cat => {
            const items = grouped[cat] || [];
            const catInfo = categories[cat];
            return `
                <div class="category-group ${catInfo.color}">
                    <div class="category-header">
                        <span class="category-dot"></span>
                        <strong>${catInfo.label}</strong>
                        <span class="category-count">${items.length}</span>
                    </div>
                    <div class="category-items">
                        ${items.map((s, idx) => {
                            const done = state.completed.includes(s.id);
                            const selected = state.active && state.active.id === s.id;
                            return `
                                <button class="scenario-card ${selected ? 'active' : ''} ${catInfo.color}" type="button" data-level="${s.id}">
                                    <span class="scenario-badge">${done ? '✓' : idx + 1}</span>
                                    <span class="scenario-title">${escapeHtml(s.title)}</span>
                                    <span class="scenario-meta">${done ? '已完成' : '未开始'}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    function selectLevelOnSetup(levelId) {
        state.active = allScenarios.find(s => s.id === levelId) || allScenarios[0];
        renderLevelList();
        const isMission = 'answers' in state.active;
        els.levelTitle.textContent = state.active.title;
        els.levelGoal.textContent = isMission ? state.active.question : state.active.goal;
        els.scenarioRole.textContent = isMission ? `${state.active.speaker}说：${state.active.otherText}` : '场景';
        els.scenarioText.textContent = isMission ? state.active.desc : state.active.scene;
        els.suggestedBar.textContent = isMission ? `提示：${state.active.hint}` : '';
        els.playModeTabs.hidden = !isMission;
        state.playMode = isMission ? 'answer' : 'ai';
        document.querySelectorAll('#playModeTabs .play-mode-tab').forEach(t => t.classList.toggle('active', t.dataset.play === state.playMode));
        showRobot(`已选「${state.active.title}」。${isMission ? '用标准答案模式最快，也可以切 AI 自由对话。' : '试试自由对话，看能不能拿到关键信息。'}`);
    }

    function showSetup() {
        els.gameSection.hidden = true;
        els.resultSection.hidden = true;
        els.setupSection.hidden = false;
        els.introSection.hidden = false;
        renderLevelList();
    }

    async function startGame(levelId, mode) {
        state.active = allScenarios.find(s => s.id === levelId) || allScenarios[0];
        state.mode = mode;
        state.ended = false;
        state.won = false;
        state.messages = [];
        state.score = 0;
        state.scoreBreakdown = { clarity: 0, strategy: 0, completion: 0 };
        state.rounds = 0;
        els.answerText.value = '';
        els.answerInput.value = '';
        showFeedback('');

        els.setupSection.hidden = true;
        els.introSection.hidden = true;
        els.gameSection.hidden = false;
        els.resultSection.hidden = true;

        els.gameLevelTitle.textContent = state.active.title;
        els.gameLevelGoal.textContent = 'answers' in state.active ? state.active.question : state.active.goal;
        els.gameScenario.querySelector('p').textContent = 'answers' in state.active ? state.active.desc : state.active.scene;
        els.modeBadge.textContent = mode === 'practice' ? '练习模式' : '挑战模式';
        els.roundBadge.textContent = '0 / ?';

        if (state.playMode === 'answer' && 'answers' in state.active) {
            showAnswerMode();
        } else {
            showAiMode();
            await startGameSession();
        }
    }

    function showAiMode() {
        els.answerBox.hidden = false;
        els.answerModeBox.hidden = true;
    }

    function showAnswerMode() {
        els.answerBox.hidden = true;
        els.answerModeBox.hidden = false;
        const m = state.active;
        els.answerQuestion.textContent = m.question;
        els.answerHint.textContent = `提示：${m.hint}`;
        const options = m.answers.slice(0, 4);
        els.answerOptions.innerHTML = options.map(a => `<button class="answer-chip" type="button" data-answer="${escapeHtml(a)}">${escapeHtml(a)}</button>`).join('');
        els.answerOptions.querySelectorAll('.answer-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                els.answerInput.value = btn.dataset.answer;
                submitStandardAnswer();
            });
        });
    }

    async function submitStandardAnswer() {
        if (state.ended) return;
        const input = els.answerInput.value.trim();
        if (!input) {
            toast('先输入或点一个推荐答案。');
            return;
        }
        const m = state.active;
        const matched = m.answers.some(ans => input.includes(ans) || ans.includes(input));
        state.won = matched;
        state.ended = true;
        state.rounds = 1;
        state.score = matched ? 100 : 30;
        state.scoreBreakdown = { clarity: matched ? 100 : 40, strategy: matched ? 100 : 30, completion: matched ? 100 : 20 };
        showFeedback(matched ? '回答正确！' : '还可以更接近标准表达。');
        if (matched) await collectCard(m);
        showResult({
            won: matched,
            xpGain: matched ? 10 : 2,
            scoreBreakdown: state.scoreBreakdown,
            reviews: matched
                ? [{ title: '标准答案', text: `推荐表达：${m.sentence}` }]
                : [{ title: '参考答案', text: m.sentence }, { title: '提示', text: m.hint }],
            suggestion: '多尝试标准表达，再进入 AI 自由对话练习。'
        });
        state.xp += matched ? 10 : 2;
        if (matched) state.streak += 1;
        else state.streak = 0;
        if (matched && !state.completed.includes(m.id)) state.completed.push(m.id);
        updateStats();
        await saveBackendState();
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
                state.xp = data.totalXp || (state.xp + (data.xpGain || 0));
                if (data.won) {
                    state.streak += 1;
                    if (!state.completed.includes(state.active.id)) state.completed.push(state.active.id);
                    await collectCard(state.active);
                } else {
                    state.streak = 0;
                }
                showResult(data);
                updateStats();
                await saveBackendState();
            }
        } catch (err) {
            console.warn('[HearBridge] 结束游戏失败:', err.message);
        } finally {
            state.sessionId = null;
        }
    }

    async function collectCard(item) {
        if (state.collected.find(c => c.id === item.id)) return;
        const sentence = item.sentence || item.suggested || item.title;
        state.collected.push({ id: item.id, title: item.title, sentence });
        await saveCardToBackend(item.id, sentence);
    }

    async function saveCardToBackend(id, sentence) {
        try {
            const res = await HearAuth.apiFetch('/api/data', { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            const samples = Array.isArray(data.samples) ? data.samples : [];
            samples.push({ id: `card-${id}`, text: sentence, source: 'challenge', createdAt: Date.now() });
            await HearAuth.apiFetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ samples })
            });
        } catch (err) {
            console.warn('[HearBridge] 保存收集卡失败:', err.message);
        }
    }

    function showResult(data) {
        els.gameSection.hidden = true;
        els.resultSection.hidden = false;
        els.resultTitle.textContent = data.won ? '通关成功' : '本轮结束';
        els.resultSummary.textContent = data.won
            ? `你完成了「${state.active.title}」，获得 ${data.xpGain || 0} 经验。`
            : `本轮没有拿到关键信息。${data.suggestion || '再试一次，记得先说明听障并请求文字。'}`;
        const breakdown = data.scoreBreakdown || state.scoreBreakdown;
        els.scoreClarity.textContent = String(breakdown.clarity || 0);
        els.scoreStrategy.textContent = String(breakdown.strategy || 0);
        els.scoreCompletion.textContent = String(breakdown.completion || 0);
        els.reviewList.innerHTML = (data.reviews || []).map(r => `<div class="review-item"><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.text)}</p></div>`).join('');
        if (data.won) {
            els.cardReward.hidden = false;
            els.cardRewardText.textContent = state.active.sentence || state.active.suggested || state.active.title;
        } else {
            els.cardReward.hidden = true;
        }
        if (data.won) showRobot('太棒了！这句常用语已经加入你的收藏卡册。');
        else showRobot('没关系，再试一次就能更熟悉。');
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
        if ('answers' in state.active) {
            showFeedback(`提示：${state.active.hint}`);
        } else {
            showFeedback('先说明听障情况，再请求对方用文字写下关键信息。');
        }
    }

    async function useSuggested() {
        if (!state.active) return;
        const suggested = state.active.suggested || state.active.sentence || '';
        if (!suggested) {
            toast('当前关卡没有预设推荐表达。');
            return;
        }
        els.answerText.value = suggested;
        toast('已填入推荐表达。');
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
            const label = event.target.closest('#answerModeBox') ? els.recordAnswerMode : els.recordAnswer;
            if (label) {
                label.textContent = '录音中...';
                label.classList.add('recording');
            }
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
        [els.recordAnswer, els.recordAnswerMode].forEach(label => {
            if (label) {
                label.textContent = '按住录音';
                label.classList.remove('recording');
            }
        });
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
            if (state.playMode === 'answer') {
                els.answerInput.value = text;
            } else {
                els.answerText.value = text;
            }
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
            if (!res.ok) throw new Error('cloud-tts-failed');
            const blob = await res.blob();
            const audio = new Audio(URL.createObjectURL(blob));
            audio.play();
        } catch (error) {
            console.warn('[HearBridge] 云端朗读失败，回退本地语音:', error.message);
            speakLocal(text);
        }
    }

    function speakLocal(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.95;
        const voices = window.speechSynthesis.getVoices();
        const zhVoice = voices.find(v => v.lang && v.lang.includes('zh') && /female|woman|xia|mei|siri/.test(v.name.toLowerCase())) || voices.find(v => v.lang && v.lang.includes('zh'));
        if (zhVoice) utterance.voice = zhVoice;
        window.speechSynthesis.speak(utterance);
    }

    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {};
        window.speechSynthesis.getVoices();
    }

    let robotTimer = null;
    function showRobot(message) {
        if (!els.robotBubble || !message) return;
        window.clearTimeout(robotTimer);
        els.robotBubble.textContent = message;
        els.robotBubble.classList.add('show');
        els.robotMascot.classList.add('cheer');
        robotTimer = window.setTimeout(() => {
            els.robotBubble.classList.remove('show');
            els.robotMascot.classList.remove('cheer');
        }, 3600);
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
