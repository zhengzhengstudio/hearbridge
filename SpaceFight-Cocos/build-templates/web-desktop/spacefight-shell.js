(() => {
  'use strict';

  const root = document.documentElement;
  const canvas = document.getElementById('GameCanvas');
  const launch = document.getElementById('LaunchButton');
  const launchStatus = document.getElementById('LaunchStatus');
  const launchLabel = document.getElementById('LaunchLabel');
  const resume = document.getElementById('ResumeButton');
  const restart = document.getElementById('RestartButton');
  const moveStick = document.getElementById('MoveStick');
  const loadoutOpen = document.getElementById('LoadoutOpen');
  const loadoutClose = document.getElementById('LoadoutClose');
  const loadoutApply = document.getElementById('LoadoutApply');
  const LOADOUT_KEY = 'spacefight-loadout-v2';
  const GRAPHICS_KEY = 'spacefight.graphics.v1';
  const INPUT_MODE_KEY = 'spacefight.input-mode.v1';
  const validInputMode = (mode) => mode === 'desktop' || mode === 'touch' ? mode : null;
  const hostInputMode = validInputMode(
    document.body.dataset.inputModeOverride || document.body.dataset.inputMode,
  );
  let storedInputMode = null;
  try { storedInputMode = validInputMode(localStorage.getItem(INPUT_MODE_KEY)); } catch (_) {}
  const explicitInputMode = hostInputMode;
  if (explicitInputMode) document.body.dataset.inputModeOverride = explicitInputMode;
  const primaryPointerIsTouch = matchMedia('(pointer: coarse)').matches
    && !matchMedia('(pointer: fine)').matches;
  let inputMode = explicitInputMode || (
    primaryPointerIsTouch ? (storedInputMode || 'touch') : 'desktop'
  );
  const setInputMode = (mode) => {
    inputMode = explicitInputMode || mode;
    document.body.dataset.inputMode = inputMode;
  };
  let engineReady = false;
  let loadTimedOut = false;
  setInputMode(inputMode);
  let stickPointerId = null;
  const validGraphicsTier = (tier) => tier === 'low' || tier === 'high' ? tier : null;
  const queryGraphicsTier = validGraphicsTier(
    new URLSearchParams(window.location.search).get('graphics'),
  );
  let storedGraphicsTier = null;
  try { storedGraphicsTier = validGraphicsTier(localStorage.getItem(GRAPHICS_KEY)); } catch (_) {}
  let graphicsTier = queryGraphicsTier || storedGraphicsTier || 'high';
  const weaponArtSources = Object.fromEntries(
    [...document.querySelectorAll('[data-weapon-art]')].map((image) => [image.dataset.weaponArt, image.src]),
  );
  const loadoutNames = {
    pulse: '脉冲炮', scatter: '散射炮', missile: '追踪导弹', rail: '磁轨炮', plasma: '等离子炮',
    targeter: '猎手阵列', repair: '纳米修复', fabricator: '弹药织机', collector: '牵引收集器', aegis: '神盾投射器',
    balanced: '均衡核心', vector: '矢量核心', bastion: '堡垒核心', reactor: '反应堆核心', phantom: '幻影核心', dreadnought: '无畏核心',
  };
  const shipCatalog = {
    interceptor: { code: 'SF-09', name: '截击机', shield: 80, armor: 100, energy: 100 },
    scout: { code: 'SF-12', name: '侦察机', shield: 68, armor: 85, energy: 100 },
    fighter: { code: 'SF-21', name: '战斗机', shield: 80, armor: 105, energy: 100 },
    bomber: { code: 'SF-33', name: '轰炸机', shield: 96, armor: 135, energy: 115 },
    gunship: { code: 'SF-47', name: '炮艇', shield: 108, armor: 120, energy: 120 },
  };

  const defaults = { ship: 'interceptor', weapon: 'pulse', device: 'targeter', core: 'balanced' };
  let loadout = { ...defaults };
  try { loadout = { ...defaults, ...JSON.parse(localStorage.getItem(LOADOUT_KEY) || '{}') }; } catch (_) {}

  function setGraphicsTier(tier, persist = true) {
    graphicsTier = validGraphicsTier(tier) || 'high';
    document.body.dataset.graphicsTier = graphicsTier;
    document.querySelectorAll('[data-graphics-choice]').forEach((button) => {
      button.dataset.selected = button.dataset.graphicsChoice === graphicsTier ? 'true' : 'false';
      button.setAttribute('aria-pressed', button.dataset.selected);
    });
    if (persist) {
      try { localStorage.setItem(GRAPHICS_KEY, graphicsTier); } catch (_) {}
      window.dispatchEvent(new CustomEvent('spacefight:graphics-tier', {
        detail: { tier: graphicsTier },
      }));
    }
  }

  setGraphicsTier(graphicsTier, false);
  document.querySelectorAll('[data-graphics-choice]').forEach((button) => {
    button.addEventListener('click', () => setGraphicsTier(button.dataset.graphicsChoice));
  });

  function updateOrientationState() {
    const blocked = inputMode === 'touch' && window.innerHeight > window.innerWidth;
    document.body.dataset.orientationBlocked = blocked ? 'true' : 'false';
    if (blocked) resetStick();
  }

  function updateShipUi() {
    const validShip = shipCatalog[loadout.ship] ? loadout.ship : 'interceptor';
    const ship = shipCatalog[validShip];
    setText('CraftCode', ship.code);
    setText('CraftRole', ship.name);
    setText('CraftShield', ship.shield);
    setText('CraftArmor', ship.armor);
    setText('CraftEnergy', ship.energy);
    document.querySelectorAll('[data-stat]').forEach((track) => {
      const value = Number(ship[track.dataset.stat]) || 0;
      track.style.setProperty('--fill', `${Math.max(6, Math.min(100, value / 1.35))}%`);
    });
    document.querySelectorAll('[data-ship-choice]').forEach((button) => {
      const selected = button.dataset.shipChoice === validShip;
      button.dataset.selected = selected ? 'true' : 'false';
      button.setAttribute('aria-pressed', String(selected));
    });
    document.body.dataset.loadoutShip = validShip;
    if (launchStatus && engineReady) launchStatus.textContent = `${ship.code} 已就绪`;
  }

  function updateLoadoutUi() {
    document.querySelectorAll('[data-loadout-slot]').forEach((button) => {
      button.dataset.selected = loadout[button.dataset.loadoutSlot] === button.dataset.loadoutValue ? 'true' : 'false';
    });
    const summary = `${loadoutNames[loadout.weapon]} / ${loadoutNames[loadout.device]} / ${loadoutNames[loadout.core]}`;
    setText('LoadoutSummary', summary);
    setText('LoadoutDetail', summary);
    setText('WeaponName', loadoutNames[loadout.weapon]);
    const weaponArt = document.getElementById('WeaponArt');
    if (weaponArt && weaponArtSources[loadout.weapon]) {
      weaponArt.src = weaponArtSources[loadout.weapon];
    }
    updateShipUi();
    document.body.dataset.loadoutWeapon = loadout.weapon;
    document.body.dataset.loadoutDevice = loadout.device;
    document.body.dataset.loadoutCore = loadout.core;
  }

  function publishLoadout() {
    localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
    updateLoadoutUi();
    window.dispatchEvent(new CustomEvent('spacefight:loadout-change', { detail: { ...loadout } }));
  }

  updateLoadoutUi();
  updateOrientationState();
  window.addEventListener('resize', updateOrientationState);
  window.addEventListener('orientationchange', updateOrientationState);
  window.addEventListener('resize', scheduleViewportLayout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportLayout);
    window.visualViewport.addEventListener('scroll', scheduleViewportLayout);
  }
  document.querySelectorAll('[data-ship-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      loadout = { ...loadout, ship: button.dataset.shipChoice };
      updateLoadoutUi();
      if (document.body.dataset.playing !== 'true') {
        window.dispatchEvent(new CustomEvent('spacefight:loadout-change', { detail: { ...loadout } }));
      }
    });
  });
  applyViewportLayout();
  document.querySelectorAll('[data-loadout-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      loadout = { ...loadout, [button.dataset.loadoutSlot]: button.dataset.loadoutValue };
      updateLoadoutUi();
    });
  });
  loadoutOpen.addEventListener('click', () => { document.body.dataset.loadoutOpen = 'true'; });
  loadoutClose.addEventListener('click', () => { document.body.dataset.loadoutOpen = 'false'; });
  loadoutApply.addEventListener('click', () => { publishLoadout(); document.body.dataset.loadoutOpen = 'false'; });

  function updateStick(event) {
    if (!moveStick) return;
    const bounds = moveStick.getBoundingClientRect();
    const centerX = bounds.left + (bounds.width / 2);
    const centerY = bounds.top + (bounds.height / 2);
    const limit = bounds.width * 0.31;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const distance = Math.hypot(rawX, rawY) || 1;
    const scale = Math.min(1, limit / distance);
    moveStick.style.setProperty('--stick-x', `${rawX * scale}px`);
    moveStick.style.setProperty('--stick-y', `${rawY * scale}px`);
  }

  function resetStick() {
    stickPointerId = null;
    if (!moveStick) return;
    moveStick.dataset.active = 'false';
    moveStick.style.setProperty('--stick-x', '0px');
    moveStick.style.setProperty('--stick-y', '0px');
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') {
      setInputMode('desktop');
      resetStick();
      updateOrientationState();
      return;
    }
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    setInputMode('touch');
    updateOrientationState();
    if (inputMode !== 'touch') return;
    if (stickPointerId === null && event.clientX <= window.innerWidth * 0.42) {
      stickPointerId = event.pointerId;
      moveStick.dataset.active = 'true';
      updateStick(event);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickPointerId) updateStick(event);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === stickPointerId) resetStick();
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (event.pointerId === stickPointerId) resetStick();
  });
  window.addEventListener('blur', resetStick);

  function markEngineReady() {
    engineReady = true;
    loadTimedOut = false;
    document.body.dataset.engineReady = 'true';
    launch.disabled = false;
    launchStatus.textContent = `${shipCatalog[loadout.ship]?.code || 'SF-09'} 已就绪`;
    launchLabel.textContent = '进入战斗';
  }

  function markEngineFailed() {
    if (engineReady) return;
    loadTimedOut = true;
    document.body.dataset.engineReady = 'error';
    launch.disabled = false;
    launchStatus.textContent = '战斗核心未完成加载';
    launchLabel.textContent = '重新加载';
  }

  window.addEventListener('spacefight:engine-ready', markEngineReady);
  window.addEventListener('spacefight:engine-error', markEngineFailed);
  window.setTimeout(markEngineFailed, 18000);

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function setBar(id, value, maximum) {
    const element = document.getElementById(id);
    if (!element) return;
    const percent = Math.max(0, Math.min(100, (Number(value) / maximum) * 100));
    element.style.width = `${percent}%`;
  }

  async function requestFlightSurface() {
    try {
      if (!document.fullscreenElement && root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (_) {
      // Installed apps and some browsers may already own the full viewport.
    }
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch (_) {
      // The portrait gate remains visible when orientation lock is unavailable.
    }
    try {
      if (matchMedia('(pointer: fine)').matches && canvas.requestPointerLock) {
        await canvas.requestPointerLock();
      }
    } catch (_) {
      // Clicking the canvas retries pointer lock when the browser requires it.
    }
    canvas.focus();
  }

  async function enterCombat() {
    if (document.body.dataset.orientationBlocked === 'true') return;
    if (!engineReady) {
      if (loadTimedOut) window.location.reload();
      return;
    }
    publishLoadout();
    await requestFlightSurface();
    document.body.dataset.playing = 'true';
    document.body.dataset.paused = 'false';
    window.dispatchEvent(new CustomEvent('spacefight:fullscreen-enter'));
  }

  async function resumeCombat() {
    window.dispatchEvent(new CustomEvent('spacefight:toggle-pause'));
    await requestFlightSurface();
  }

  launch.addEventListener('click', enterCombat);
  resume.addEventListener('click', resumeCombat);
  restart.addEventListener('click', async () => {
    window.dispatchEvent(new CustomEvent('spacefight:restart'));
    document.body.dataset.mission = 'active';
    await requestFlightSurface();
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.dataset.playing === 'true') {
      document.body.dataset.playing = 'false';
      document.body.dataset.paused = 'false';
      window.dispatchEvent(new CustomEvent('spacefight:fullscreen-exit'));
    }
  });

  document.addEventListener('pointerlockchange', () => {
    document.body.dataset.pointerLocked = document.pointerLockElement === canvas ? 'true' : 'false';
  });

  window.addEventListener('spacefight:combat-state', (event) => {
    const state = event.detail || {};
    setText('HealthValue', Math.round(state.health || 0));
    setText('ShieldValue', Math.round(state.shield || 0));
    setText('EnergyValue', Math.round(state.energy || 0));
    setText('KillValue', state.kills || 0);
    setText('KillTarget', state.requiredKills || 1);
    setText('WaveValue', state.wave || 1);
    setText('SectorValue', state.sectorName || '碎光航道');
    setText('EventValue', state.eventName || '敌袭预警');
    setText('CameraValue', state.cameraMode === 'cockpit' ? '驾驶舱' : '追尾');
    setText('MissionLabel', state.missionStatus === 'complete' ? '下一波接近' : state.missionStatus === 'failed' ? '战机失联' : '清除航道威胁');
    setBar('HealthBar', state.health || 0, state.maxHealth || 100);
    setBar('ShieldBar', state.shield || 0, state.maxShield || 80);
    setBar('EnergyBar', state.energy || 0, state.maxEnergy || 100);
    document.body.dataset.paused = state.paused ? 'true' : 'false';
    document.body.dataset.mission = state.missionStatus || 'active';
  });
  // 折叠屏 / 三折叠 / 阔折叠 / 双屏：宽高比会在不重载页面的情况下突变，
  // 所以每次尺寸变化都重新求值，绝不把首次 orientation 当成永久状态。
  function applyViewportLayout() {
    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 720;
    const shortEdge = Math.min(width, height);
    const longEdge = Math.max(width, height);
    const aspect = longEdge / Math.max(1, shortEdge);
    let segments = 0;
    try {
      segments = typeof window.getWindowSegments === 'function'
        ? window.getWindowSegments().length : 0;
    } catch (_) {}
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent
      ? navigator.userAgent : '').toLowerCase();
    let form = 'phone';
    if (segments >= 2 || ua.includes('surface duo')) form = 'dual-screen';
    else if (ua.includes('mate xt') || ua.includes('tri-fold')) {
      form = aspect < 1.22 ? 'tri-fold-dual' : aspect < 1.75 ? 'tri-fold-triple' : 'tri-fold-single';
    } else if ((ua.includes('pura x') || ua.includes('wide-fold')) && aspect < 1.3) form = 'wide-fold';
    else if (ua.includes('ipad') || (ua.includes('macintosh') && navigator.maxTouchPoints > 1)) form = 'tablet';
    else if (ua.includes('iphone') || ua.includes('ipod')) form = 'iphone';
    else if (aspect >= 2.4) form = 'fold-closed';
    else if (shortEdge >= 700 && aspect >= 1.2 && aspect <= 1.55) form = 'fold-open';
    else if (shortEdge >= 760 && aspect <= 1.7) form = 'tablet';

    const aspectClass = aspect < 1.16 ? 'square'
      : aspect < 1.62 ? 'standard' : aspect < 2.05 ? 'wide'
        : aspect < 2.65 ? 'ultrawide' : 'tall';
    const columns = shortEdge < 560 ? 1 : shortEdge < 900 ? 2 : 3;
    const hudScale = Math.min(1.12, Math.max(0.82, 0.82 + (shortEdge - 480) / 2600));
    const contentMax = Math.round(Math.min(1680, Math.max(720, shortEdge * 1.9)));
    const seam = form === 'dual-screen' ? 34 : 0;
    const letterboxY = aspect < 1.18 ? 5.5 : aspect > 2.5 ? 3.5 : 0;

    const setCssVar = (name, value) => {
      if (root && root.style && typeof root.style.setProperty === 'function') {
        root.style.setProperty(name, value);
      }
    };
    setCssVar('--sf-columns', String(columns));
    setCssVar('--sf-hud-scale', hudScale.toFixed(3));
    setCssVar('--sf-content-max', `${contentMax}px`);
    setCssVar('--sf-seam', `${seam}px`);
    setCssVar('--sf-letterbox-y', `${letterboxY}vh`);
    document.body.dataset.formFactor = form;
    document.body.dataset.aspectClass = aspectClass;
    if (typeof CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('spacefight:viewport-layout', {
        detail: { formFactor: form, aspectClass, aspect, columns, hudScale, seamInset: seam },
      }));
    }
  }

  let viewportFrame = 0;
  function scheduleViewportLayout() {
    if (viewportFrame) return;
    if (typeof requestAnimationFrame !== 'function') {
      applyViewportLayout();
      return;
    }
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      applyViewportLayout();
    });
  }


  /* 设置面板 / 新手教学关 / 星港券结算提示（本轮新增） */
  const INPUT_KEY = 'spacefight.input.v1';
  const settingsOpenButton = document.getElementById('SettingsOpen');
  const settingsCloseButton = document.getElementById('SettingsClose');
  const tutorialStartButton = document.getElementById('TutorialStart');
  const tutorialHint = document.getElementById('TutorialHint');
  const tutorialStep = document.getElementById('TutorialStep');
  const tutorialText = document.getElementById('TutorialText');
  const ticketToast = document.getElementById('TicketToast');
  const TUTORIAL_HINTS = {
    'tutorial.move': '拖动移动杆推进与横移',
    'tutorial.target': '击落训练靶机',
    'tutorial.pickup': '飞近发光物资并回收',
    'tutorial.return': '轻点返航，回前哨站看星港券结算',
  };

  function readSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(INPUT_KEY) || '{}');
      return {
        sensitivity: Number(raw.sensitivity) || 1,
        invertY: raw.invertY === true,
        leftHanded: raw.leftHanded === true,
        controlScale: Number(raw.controlScale) || 1,
      };
    } catch (_) {
      return { sensitivity: 1, invertY: false, leftHanded: false, controlScale: 1 };
    }
  }

  function writeSettings(next) {
    try { localStorage.setItem(INPUT_KEY, JSON.stringify(next)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('spacefight:input-settings', { detail: next }));
  }

  function syncSettingsUi() {
    const settings = readSettings();
    const sensitivity = document.getElementById('SettingsSensitivity');
    const scale = document.getElementById('SettingsControlScale');
    if (sensitivity) sensitivity.value = String(settings.sensitivity);
    if (scale) scale.value = String(settings.controlScale);
    const sensitivityValue = document.getElementById('SettingsSensitivityValue');
    const scaleValue = document.getElementById('SettingsControlScaleValue');
    if (sensitivityValue) sensitivityValue.textContent = settings.sensitivity.toFixed(2);
    if (scaleValue) scaleValue.textContent = `${Math.round(settings.controlScale * 100)}%`;
    document.querySelectorAll('[data-settings-toggle]').forEach((button) => {
      const on = settings[button.dataset.settingsToggle] === true;
      button.textContent = on ? '开启' : '关闭';
      button.setAttribute('aria-pressed', String(on));
      button.dataset.selected = String(on);
    });
    document.querySelectorAll('[data-settings-graphics]').forEach((button) => {
      const selected = button.dataset.settingsGraphics === graphicsTier;
      button.dataset.selected = String(selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  settingsOpenButton?.addEventListener('click', () => {
    document.body.dataset.settingsOpen = 'true';
    document.getElementById('SettingsPanel')?.setAttribute('aria-hidden', 'false');
    syncSettingsUi();
  });
  settingsCloseButton?.addEventListener('click', () => {
    document.body.dataset.settingsOpen = 'false';
    document.getElementById('SettingsPanel')?.setAttribute('aria-hidden', 'true');
  });
  document.querySelectorAll('[data-settings-graphics]').forEach((button) => {
    button.addEventListener('click', () => { setGraphicsTier(button.dataset.settingsGraphics); syncSettingsUi(); });
  });
  document.querySelectorAll('[data-settings-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const settings = readSettings();
      settings[button.dataset.settingsToggle] = !settings[button.dataset.settingsToggle];
      writeSettings(settings);
      syncSettingsUi();
    });
  });
  for (const [id, key] of [['SettingsSensitivity', 'sensitivity'], ['SettingsControlScale', 'controlScale']]) {
    document.getElementById(id)?.addEventListener('input', (event) => {
      const settings = readSettings();
      settings[key] = Number(event.target.value);
      writeSettings(settings);
      syncSettingsUi();
    });
  }
  tutorialStartButton?.addEventListener('click', () => {
    document.body.dataset.settingsOpen = 'false';
    document.getElementById('SettingsPanel')?.setAttribute('aria-hidden', 'true');
    document.body.dataset.missionPreset = 'tutorial';
    // 从设置面板进入不经过 LaunchButton 的 capture 监听，必须显式同步预设，
    // 否则只会切成 tutorial 关卡而不会开启四步引导。
    window.dispatchEvent(new CustomEvent('spacefight:mission-change'));
    enterCombat();
  });
  /* capture 阶段先于原 enterCombat 冒泡监听：每次出击前把浏览器里的任务预设同步进仿真。 */
  launch.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('spacefight:mission-change'));
  }, true);
  window.addEventListener('spacefight:tutorial-step', (event) => {
    const state = event.detail || {};
    if (state.clear || state.complete) {
      if (tutorialHint) tutorialHint.hidden = true;
      /* 教学关走完后，下次出击自动回到常规任务。 */
      if (state.complete) document.body.dataset.missionPreset = 'salvage';
      return;
    }
    if (!tutorialHint) return;
    tutorialHint.hidden = false;
    if (tutorialStep) tutorialStep.textContent = `第 ${state.current}/${state.total} 步`;
    if (tutorialText) tutorialText.textContent = TUTORIAL_HINTS[state.key] || '';
  });
  window.addEventListener('spacefight:tickets-awarded', (event) => {
    const state = event.detail || {};
    if (!ticketToast || !(state.amount > 0)) return;
    ticketToast.textContent = `本趟结算  +${state.amount} 星港券（货值 ${state.cargoValue || 0} · 击落 ${state.kills || 0}）`;
    ticketToast.hidden = false;
    window.setTimeout(() => { ticketToast.hidden = true; }, 4200);
  });
  syncSettingsUi();

})();
