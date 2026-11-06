'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const hud = fs.readFileSync(
  path.join(root, 'SpaceFight-Cocos/assets/scripts/game/NativeCombatHud.ts'),
  'utf8',
);

test('native equipment bench exposes every resolved combat loadout slot', () => {
  const slots = ['weapon', 'secondary', 'device', 'core', 'engine', 'shield', 'utility', 'boost', 'skin'];

  for (const slot of slots) {
    assert.match(hud, new RegExp(`\\b${slot}: \\[`), `${slot} must have selectable options`);
    assert.match(hud, new RegExp(`\\b${slot}: '[^']+'`), `${slot} must have a readable slot name`);
  }
  assert.match(hud, /device: \['targeter', 'repair', 'fabricator', 'collector', 'aegis', 'jammer', 'overclock', 'decoy'\]/);
  assert.match(hud, /onApplyLoadout\?\.\(\{ \.\.\.this\.pendingLoadout \}\)/);
  assert.match(hud, /LoadoutClose', this\.text\('loadout\.back'\)/);
});

test('equipment values come from the combat catalogs and resolved loadout', () => {
  for (const catalog of [
    'PRIMARY_WEAPONS',
    'SECONDARY_WEAPONS',
    'TACTICAL_DEVICES',
    'FRAME_CORES',
    'ENGINE_MODULES',
    'SHIELD_MODULES',
    'UTILITY_MODULES',
    'BOOST_MODULES',
  ]) {
    assert.match(hud, new RegExp(`\\b${catalog}\\[`), `${catalog} must drive displayed values`);
  }
  assert.match(hud, /private loadoutMetrics\(loadout: ResolvedCombatLoadout\)/);
  assert.match(hud, /primary\.damage \* damageMultiplier/);
  assert.match(hud, /core\.maxShield \* shield\.capacityMultiplier/);
  assert.match(hud, /core\.speedMultiplier \* engine\.speedMultiplier/);
  assert.match(hud, /this\.text\('summary\.primary'/);
  assert.match(hud, /this\.text\('summary\.defense'/);
});

test('compact landscape hangar keeps nine targets and footer actions inside safe space', () => {
  assert.match(hud, /const columns = compact && usableWidth < 650 \? 3 : 4/);
  assert.match(hud, /const contentCenterX = \(this\.safeInsets\.left - this\.safeInsets\.right\) \/ 2/);
  assert.match(hud, /const rows = Math\.ceil\(this\.loadoutLabels\.size \/ columns\)/);
  assert.match(hud, /const gridAreaWidth = usableWidth \* \(ultraCompact \? 0\.62 : compact \? 0\.58 : 0\.48\)/);
  assert.match(hud, /const buttonHeight = Math\.max\(ultraCompact \? 36 : 44,/);
  assert.match(hud, /const actionHeight = ultraCompact \? 38 : compact \? 44 : 52/);
  assert.match(hud, /this\.safeInsets\.left.*this\.safeInsets\.right/);
  assert.match(hud, /this\.safeInsets\.top.*this\.safeInsets\.bottom/);
  assert.match(hud, /NativeLoadoutSlotRail/);
  assert.match(hud, /NativeLoadoutDetail/);
  assert.match(hud, /NativeLoadoutShipSchematic/);
  assert.match(hud, /slot === this\.selectedLoadoutSlot \? HUD_ACTIVE : HUD_CYAN/);
  assert.doesNotMatch(hud, /button\.setScale\(new Vec3\(scale, scale, 1\)\)/);

  const width = 640;
  const height = 360;
  const safe = { left: 24, right: 24, top: 18, bottom: 18 };
  const usableWidth = width - safe.left - safe.right - 24;
  const usableHeight = height - safe.top - safe.bottom - 16;
  const columns = 3;
  const rows = 3;
  const gapX = 8;
  const gapY = 7;
  const buttonWidth = Math.min(214, (usableWidth - ((columns - 1) * gapX)) / columns);
  const actionHeight = 44;
  const actionY = (-height / 2) + safe.bottom + (actionHeight / 2) + 5;
  const actionTop = actionY + (actionHeight / 2);
  const feedbackY = actionTop + 4 + 11;
  const summaryY = feedbackY + 11 + 3 + 19;
  const gridBottom = summaryY + 19 + 5;
  const gridTop = (height / 2) - safe.top - 50;
  const availableGridHeight = Math.max(rows * 44, gridTop - gridBottom);
  const buttonHeight = Math.max(44, Math.min(72, (availableGridHeight - ((rows - 1) * gapY)) / rows));
  const gridWidth = (columns * buttonWidth) + ((columns - 1) * gapX);
  const renderedGridBottom = gridTop - (rows * buttonHeight) - ((rows - 1) * gapY);

  assert.ok(buttonWidth >= 44, 'slot width remains touchable');
  assert.ok(buttonHeight >= 44, 'slot height remains touchable');
  assert.ok(gridWidth <= usableWidth + 0.001, 'slot grid stays within horizontal safe area');
  assert.ok(renderedGridBottom >= gridBottom - 0.001, 'slot grid does not collide with summary and footer');
  assert.ok(actionY - (actionHeight / 2) >= (-height / 2) + safe.bottom, 'footer stays above bottom inset');
  assert.ok(usableHeight > 0);
});

test('applying a configuration produces persistent visible feedback', () => {
  assert.match(hud, /this\.text\(enteringBattle \? 'loadout\.entering' : 'loadout\.committed'\)/);
  assert.match(hud, /this\.statusLabel\.string = this\.text\('status\.loadout', \{ message: feedback \}\)/);
  assert.match(hud, /this\.setButtonText\(this\.loadoutButton, this\.text\('loadout\.applied'\)\)/);
  assert.match(hud, /NativeLoadoutFeedback/);
});

test('native bootstrap can open a clear preflight equipment flow', () => {
  assert.match(hud, /public showPreflight\(\): void/);
  assert.match(hud, /this\.setButtonText\(this\.applyLoadoutButton, this\.text\('loadout\.applyEnter'\)\)/);
  assert.match(hud, /this\.setButtonText\(this\.closeLoadoutButton, this\.text\('loadout\.defaultEnter'\)\)/);
  assert.match(hud, /this\.loadoutFeedbackLabel\.string = this\.text\('loadout\.confirmEnter'\)/);
  assert.match(hud, /this\.setLoadoutOpen\(true\)/);
  assert.match(hud, /if \(this\.preflight\) \{[\s\S]*this\.commitLoadout\(true\)/);
});

test('native HUD shares handed and scaled control geometry with input routing', () => {
  assert.match(hud, /touchLayout\(\): NativeTouchLayout/);
  assert.match(hud, /touchActionLayout\([\s\S]*this\.leftHanded[\s\S]*this\.controlScale/);
  assert.match(hud, /movementControlCircle\([\s\S]*this\.leftHanded[\s\S]*this\.controlScale/);
  assert.match(hud, /visual\.radius = control\.radius/);
  assert.match(hud, /this\.drawActionControl\(visual\.graphics, control\.role, visual\.radius, false\)/);
});

test('status and loadout entry use their actual widths instead of overflowing from an edge center', () => {
  assert.match(hud, /const statusCenterX = this\.leftHanded/);
  assert.match(hud, /this\.width - this\.safeInsets\.right - 12 - \(statusWidth \/ 2\)/);
  assert.match(hud, /this\.safeInsets\.left \+ 12 \+ \(statusWidth \/ 2\)/);
  assert.match(hud, /this\.safeInsets\.left \+ 12 \+ \(loadoutButtonWidth \/ 2\)/);
  assert.match(hud, /this\.resizePanelButton\(this\.loadoutButton, loadoutButtonWidth, loadoutButtonHeight, 14\)/);
});

test('native combat HUD exposes expedition, cargo, target role, and contextual return controls', () => {
  assert.match(hud, /ExpeditionObjectiveStrip/);
  assert.match(hud, /CargoStrip/);
  assert.match(hud, /ReturnAction/);
  assert.match(hud, /snapshot\.expedition\.canReturn/);
  assert.match(hud, /snapshot\.cargo\.usedSlots/);
  assert.match(hud, /target\.role/);
  assert.match(hud, /event\.wave \|\| snapshot\.mission\.wave/);
});
