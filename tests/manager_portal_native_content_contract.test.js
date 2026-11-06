const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const android = fs.readFileSync(
  path.join(root, 'apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java'),
  'utf8'
);
const ios = fs.readFileSync(path.join(root, 'apps/ManagerPortal-iOS/Sources/main.swift'), 'utf8');
const mac = fs.readFileSync(path.join(root, 'apps/ManagerPortalMac/Sources/main.swift'), 'utf8');
const harmony = fs.readFileSync(
  path.join(root, 'apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets'),
  'utf8'
);

function methodBody(name) {
  const declaration = new RegExp(`private\\s+[\\w<>\\[\\]]+\\s+${name}\\(`).exec(android);
  assert.ok(declaration, `NativeMainActivity must define ${name}`);
  const start = declaration.index;
  const bodyStart = android.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < android.length; index += 1) {
    if (android[index] === '{') depth += 1;
    if (android[index] === '}') depth -= 1;
    if (depth === 0) return android.slice(start, index + 1);
  }
  throw new Error(`${name} has an unclosed method body`);
}

test('Android source guard: scoped modules use native content workspace records and editors', () => {
  const nativeModuleWorkspace = methodBody('showNativeModuleWorkspace');
  const contentModules = methodBody('isContentModule');
  const workspace = methodBody('showContentWorkspace');
  const renderedWorkspace = methodBody('renderContentWorkspace');
  const record = methodBody('renderContentRecord');
  const editor = methodBody('showContentEditor');

  for (const moduleId of ['media', 'downloads', 'documents', 'websites', 'works']) {
    assert.match(contentModules, new RegExp(`"${moduleId}"`));
  }
  assert.match(nativeModuleWorkspace, /showContentWorkspace/);
  assert.match(workspace, /\/api\/admin\/manager\/content\//);
  assert.match(workspace, /optJSONObject\("workspace"\)/);
  assert.match(renderedWorkspace, /optJSONArray\("records"\)/);
  assert.match(record, /optJSONArray\("fields"\)/);
  assert.match(record, /optJSONArray\("actions"\)/);
  assert.match(editor, /new EditText\(this\)/);
  assert.match(editor, /field\.optBoolean\("editable"\)/);
  assert.doesNotMatch(nativeModuleWorkspace, /toString\(2\)/);
});

test('Android source guard: declared actions include website creation and target-named deletion', () => {
  const editor = methodBody('showContentEditor');
  const record = methodBody('renderContentRecord');
  const deleteConfirmation = methodBody('showContentDeleteConfirmation');
  const submit = methodBody('submitContentAction');

  assert.match(editor, /createFields/);
  assert.match(editor, /"create"/);
  assert.match(record, /"update"/);
  assert.match(record, /"delete"/);
  assert.match(deleteConfirmation, /new AlertDialog\.Builder\(this\)/);
  assert.match(deleteConfirmation, /record\.optString\("title"/);
  assert.match(deleteConfirmation, /recordId, null/);
  assert.match(submit, /\/api\/admin\/manager\/content\/" \+ urlEncode\(moduleId\) \+ "\/action/);
  for (const key of ['moduleId', 'action', 'recordId', 'revision', 'values', 'confirmation']) {
    assert.match(submit, new RegExp(`body\\.put\\("${key}"`));
  }
  assert.match(submit, /showContentWorkspace\(moduleId, moduleLabel, moduleGroup\)/);
});

test('Android source guard: content requests expire 401 sessions and retain 403 sessions', () => {
  const expire = methodBody('expireSessionAndShowLogin');
  const workspace = methodBody('showContentWorkspace');
  const submit = methodBody('submitContentAction');

  assert.match(android, /new HttpResult\(statusCode/);
  assert.match(expire, /PREF_MANAGER_TOKEN/);
  assert.match(expire, /PREF_MANAGER_USERNAME/);
  assert.match(expire, /PREF_MANAGER_PERMISSIONS/);
  assert.match(expire, /showLogin\(\)/);
  assert.match(workspace, /handleAuthenticatedUnauthorized\(result\)/);
  assert.match(submit, /handleAuthenticatedUnauthorized\(result\)/);
  assert.match(workspace, /statusCode == 403/);
  assert.match(submit, /statusCode == 403/);
  assert.doesNotMatch(workspace, /statusCode == 403[\s\S]{0,120}expireSessionAndShowLogin/);
  assert.doesNotMatch(submit, /statusCode == 403[\s\S]{0,120}expireSessionAndShowLogin/);
});

test('Android source guard: notification callers use authenticated JSON dispatch', () => {
  const notices = methodBody('fetchNotices');

  assert.match(notices, /getJson\("\/api\/admin\/manager\/alerts/);
  assert.doesNotMatch(notices, /readUrl\([^\n]+\)\.json/);
});

test('Android source guard: authenticated update requests use status-aware JSON dispatch', () => {
  const updates = methodBody('checkUpdate');
  const download = methodBody('downloadUpdate');
  const getJsonResult = methodBody('getJsonResult');

  assert.match(updates, /getJson\("\/api\/admin\/manager\/apps"/);
  assert.match(download, /getJson\("\/api\/admin\/manager\/apps\/download-token\?file="/);
  assert.doesNotMatch(updates, /readUrl\(/);
  assert.doesNotMatch(download, /readUrl\(/);
  assert.match(getJsonResult, /final String requestToken = token/);
  assert.match(getJsonResult, /final String requestUsername = username/);
});

test('Android source guard: authenticated JSON helpers preserve status without expiring login requests', () => {
  const getJson = methodBody('getJson');
  const postJson = methodBody('postJson');
  const requestJson = methodBody('requestJson');
  const deliver = methodBody('deliverAuthenticatedJson');
  const unauthorized = methodBody('handleAuthenticatedUnauthorized');

  assert.match(getJson, /deliverAuthenticatedJson/);
  assert.match(postJson, /deliverAuthenticatedJson/);
  assert.match(requestJson, /deliverAuthenticatedJson/);
  assert.match(unauthorized, /result\.requestToken/);
  assert.match(unauthorized, /result\.requestUsername/);
  assert.match(unauthorized, /statusCode != 401/);
  assert.match(unauthorized, /handler\.post/);
  assert.match(unauthorized, /expireSessionAndShowLogin\(\)/);
  assert.match(deliver, /statusCode == 403/);
  assert.match(deliver, /callback\.done/);
});

test('Android source guard: content cache is module-scoped and stale responses are ignored', () => {
  const workspace = methodBody('showContentWorkspace');
  const editor = methodBody('showContentEditor');
  const login = methodBody('showLogin');
  const acceptSession = methodBody('acceptAdminSession');
  const invalidate = methodBody('invalidateContentWorkspaceState');
  const navigation = methodBody('buildBottomNavigation');

  assert.match(android, /Map<String, JSONObject> cachedContentWorkspaces/);
  assert.doesNotMatch(android, /JSONObject cachedContentWorkspace;/);
  assert.match(workspace, /beginContentWorkspacePage\(moduleId\)/);
  assert.match(workspace, /isCurrentContentPage\(moduleId, generation\)/);
  assert.match(workspace, /cachedContentWorkspaces\.put\(moduleId, workspace\)/);
  assert.match(editor, /cachedContentWorkspaces\.get\(moduleId\)/);
  assert.match(editor, /workspace != currentWorkspace/);
  assert.match(login, /invalidateContentWorkspaceState\(\)/);
  assert.match(acceptSession, /invalidateContentWorkspaceState\(\)/);
  assert.match(invalidate, /cachedContentWorkspaces\.clear\(\)/);
  assert.match(navigation, /navigateAwayFromContent/);
});

test('Android source guard: choice fields use a bounded native Spinner', () => {
  const editor = methodBody('showContentEditor');

  assert.match(editor, /"choice"\.equals\(type\)/);
  assert.match(editor, /field\.optJSONArray\("options"\)/);
  assert.match(editor, /new Spinner\(this\)/);
  assert.match(editor, /new ArrayAdapter<String>/);
  assert.match(editor, /option instanceof JSONObject/);
  assert.doesNotMatch(editor, /if \(value\.length\(\) == 0\) continue/);
  assert.match(editor, /"未分类"/);
  assert.match(editor, /spinner\.setEnabled\(false\)/);
  assert.match(editor, /editorChoiceValues/);
});

function swiftMethodBody(source, name) {
  const declaration = new RegExp(`private\\s+func\\s+${name}\\(`).exec(source);
  assert.ok(declaration, `Swift client must define ${name}`);
  const start = declaration.index;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} has an unclosed method body`);
}

function arktsMethodBody(name) {
  const declaration = new RegExp(`private\\s+(?:async\\s+)?${name}\\(`).exec(harmony);
  assert.ok(declaration, `HarmonyOS client must define ${name}`);
  const start = declaration.index;
  const bodyStart = harmony.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < harmony.length; index += 1) {
    if (harmony[index] === '{') depth += 1;
    if (harmony[index] === '}') depth -= 1;
    if (depth === 0) return harmony.slice(start, index + 1);
  }
  throw new Error(`${name} has an unclosed method body`);
}

for (const [platform, source, fieldControl, multilineControl, choiceControl] of [
  ['iOS', ios, 'UITextField', 'UITextView', 'UIMenu'],
  ['macOS', mac, 'NSTextField', 'NSTextView', 'NSPopUpButton']
]) {
  test(`${platform} source guard: scoped modules render native content records and editors`, () => {
    const open = swiftMethodBody(source, 'openNativeModule');
    const workspace = swiftMethodBody(source, 'showContentWorkspace');
    const record = swiftMethodBody(source, 'contentRecordView');
    const editor = swiftMethodBody(source, 'showContentEditor');
    const legacy = swiftMethodBody(source, 'showNativeModuleWorkspace');

    assert.match(open, /isContentModule/);
    assert.match(workspace, /\/api\/admin\/manager\/content\//);
    assert.match(workspace, /workspace/);
    assert.match(record, /records|fields|actions/);
    assert.match(editor, new RegExp(fieldControl));
    assert.match(editor, new RegExp(multilineControl));
    assert.match(editor, new RegExp(choiceControl));
    assert.match(editor, /createFields/);
    assert.doesNotMatch(legacy, /prettyJSON/);
  });

  test(`${platform} source guard: content mutations are bounded and protect destructive actions`, () => {
    const record = swiftMethodBody(source, 'contentRecordView');
    const editor = swiftMethodBody(source, 'showContentEditor');
    const remove = swiftMethodBody(source, 'confirmContentDelete');
    const submit = swiftMethodBody(source, 'submitContentAction');

    assert.match(record, /update/);
    assert.match(record, /delete/);
    assert.match(editor, /saveButton\.isEnabled = false/);
    assert.match(remove, /record.*title|title.*record/);
    assert.match(remove, /confirmation: recordId/);
    assert.match(submit, /moduleId/);
    assert.match(submit, /action/);
    assert.match(submit, /recordId/);
    assert.match(submit, /revision/);
    assert.match(submit, /values/);
    assert.match(submit, /confirmation/);
    assert.match(submit, /\/api\/admin\/manager\/content\//);
    if (platform === 'iOS') {
      assert.match(editor, /UIAction\(title:[\s\S]*?\{ \[weak choiceButton\] _ in/);
      assert.match(editor, /saveButton\.addAction\(UIAction \{ \[weak self, weak editor, weak saveButton, weak formStatus\] _ in/);
      assert.doesNotMatch(editor, /UIAction\(title:[\s\S]*?\{ _ in[\s\S]*?choiceButton\.setTitle/);
      assert.doesNotMatch(editor, /saveButton\.addAction\(UIAction \{ \[weak self, weak editor\] _ in/);
    } else {
      const navigation = swiftMethodBody(source, 'navButton');
      const primary = swiftMethodBody(source, 'primaryButton');
      const secondary = swiftMethodBody(source, 'secondaryButton');
      assert.match(source, /objc_setAssociatedObject/);
      assert.match(source, /final class ControlActionOwner/);
      assert.doesNotMatch(source, /static let shared = ClosureSleeve/);
      assert.doesNotMatch(source, /actions:\s*\[NSButton:\s*\(\) -> Void\]/);
      assert.match(navigation, /bindControlAction/);
      assert.match(primary, /bindControlAction/);
      assert.match(secondary, /bindControlAction/);
      assert.match(editor, /bindControlAction\(saveButton\) \{ \[weak self, weak editor, weak saveButton, weak formStatus\]/);
    }
  });

  test(`${platform} source guard: content sessions are generation-safe and keep 403 credentials`, () => {
    const workspace = swiftMethodBody(source, 'showContentWorkspace');
    const expire = swiftMethodBody(source, 'expireSessionAndShowLogin');
    const authenticated = swiftMethodBody(source, 'handleContentUnauthorized');

    assert.match(source, /contentWorkspaces/);
    assert.match(source, /contentGeneration/);
    assert.match(workspace, /beginContentWorkspace/);
    assert.match(workspace, /isCurrentContentWorkspace/);
    assert.match(workspace, /statusCode == 403/);
    assert.doesNotMatch(workspace, /statusCode == 403[\s\S]{0,160}expireSessionAndShowLogin/);
    assert.match(authenticated, /requestToken/);
    assert.match(authenticated, /requestUsername/);
    assert.match(authenticated, /statusCode == 401/);
    assert.match(authenticated, /expireSessionAndShowLogin/);
    assert.match(expire, /managerToken/);
    assert.match(expire, /managerUsername/);
    assert.match(expire, /contentWorkspaces\.removeAll/);
  });
}

test('HarmonyOS source guard: scoped modules render typed native content records and editors', () => {
  for (const type of ['ContentWorkspace', 'ContentRecord', 'ContentField', 'ContentChoice', 'ContentRequestResult', 'ContentEditorState']) {
    assert.match(harmony, new RegExp(`interface\\s+${type}`));
  }
  for (const moduleId of ['media', 'downloads', 'documents', 'websites', 'works']) {
    assert.match(harmony, new RegExp(`'${moduleId}'`));
  }
  assert.match(harmony, /\/api\/admin\/manager\/content\/\$\{encodeURIComponent\(moduleId\)\}/);
  assert.match(harmony, /TextInput\(\{ placeholder:/);
  assert.match(harmony, /TextArea\(\{ placeholder:/);
  assert.match(harmony, /ForEach\(this\.contentWorkspace\.records/);
  assert.match(harmony, /field\.options/);
  assert.match(harmony, /editorChoiceValues/);
  assert.match(harmony, /option\.value/);
  assert.doesNotMatch(harmony, /if \(option\.value\.length === 0\) continue/);
});

test('HarmonyOS source guard: editor state and selector use ArkTS-compatible typed values', () => {
  assert.doesNotMatch(harmony, /\{\s*\.\.\./);
  assert.match(harmony, /copyContentEditor\(source: ContentEditorState\): ContentEditorState/);
  assert.match(harmony, /copyEditorValues\(source: Record<string, string>\): Record<string, string>/);
  assert.match(harmony, /choiceSelectOptions\(field: ContentField\): SelectOption\[\]/);
  assert.match(harmony, /let selectOption: SelectOption = \{ value: option\.label \}/);
  assert.match(harmony, /Select\(this\.choiceSelectOptions\(field\)\)/);
  assert.match(harmony, /this\.editorChoiceValues\[field\.key\]/);
  assert.doesNotMatch(harmony, /values\[index\] \|\| ''/);
});

test('HarmonyOS source guard: uncached module navigation clears stale record actions', () => {
  const workspace = arktsMethodBody('showContentWorkspace');
  const view = arktsMethodBody('NativeModuleView');

  assert.match(workspace, /this\.contentWorkspace = cached \? cached : this\.emptyContentWorkspace\(\)/);
  assert.match(view, /isContentModule\(this\.contentWorkspaceModuleId\)/);
  assert.match(view, /this\.contentWorkspace\.module === this\.contentWorkspaceModuleId/);
});

test('HarmonyOS source guard: matching-session 401 expires before stale GET generation returns', () => {
  const workspace = arktsMethodBody('showContentWorkspace');
  const unauthorized = workspace.indexOf('if (result.statusCode === 401)');
  const staleReturn = workspace.indexOf('if (!this.isCurrentContentWorkspace(moduleId, generation)) return');

  assert.ok(unauthorized >= 0, 'showContentWorkspace must handle authenticated 401');
  assert.ok(staleReturn >= 0, 'showContentWorkspace must reject stale UI responses');
  assert.ok(unauthorized < staleReturn, 'matching-session 401 must be handled before stale UI rejection');
  assert.match(workspace, /await this\.handleContentResult\(result\)/);
});

test('HarmonyOS source guard: content actions support website creation, draft retention, and named deletion', () => {
  assert.match(harmony, /createFields/);
  assert.match(harmony, /openContentEditor\('create'/);
  assert.match(harmony, /openContentEditor\('update'/);
  assert.match(harmony, /confirmContentDelete/);
  assert.match(harmony, /确认删除 \$\{record\.title\}/);
  assert.match(harmony, /\/api\/admin\/manager\/content\/\$\{encodeURIComponent\(moduleId\)\}\/action/);
  for (const key of ['moduleId', 'action', 'recordId', 'revision', 'values', 'confirmation']) {
    assert.match(harmony, new RegExp(`'${key}'`));
  }
  assert.match(harmony, /contentEditor\.isSaving = true/);
  assert.match(harmony, /contentEditor\.isSaving = false/);
  assert.match(harmony, /await this\.showContentWorkspace\(module\)/);
});

test('HarmonyOS source guard: content responses are module-generation and session-snapshot safe', () => {
  assert.match(harmony, /contentGeneration/);
  assert.match(harmony, /beginContentWorkspace\(moduleId\)/);
  assert.match(harmony, /isCurrentContentWorkspace\(moduleId, generation\)/);
  assert.match(harmony, /contentWorkspaceCache/);
  assert.match(harmony, /requestToken/);
  assert.match(harmony, /requestUsername/);
  assert.match(harmony, /statusCode === 401/);
  assert.match(harmony, /statusCode === 403/);
  assert.match(harmony, /this\.contentWorkspace = this\.emptyContentWorkspace\(\)/);
  assert.match(harmony, /this\.permissions = \[\]/);
  assert.match(harmony, /this\.selectedTab = 0/);
  assert.doesNotMatch(harmony, /statusCode === 403[\s\S]{0,180}clearSession\(\)/);
});

test('HarmonyOS source guard: scoped modules do not use a raw JSON workspace or arbitrary requests', () => {
  assert.match(harmony, /isContentModule\(item\.id\)/);
  assert.match(harmony, /isContentAction\(action\)/);
  assert.doesNotMatch(harmony, /nativeModuleData = JSON\.stringify\(data, null, 2\)/);
  assert.doesNotMatch(harmony, /request\(item\.endpoint, http\.RequestMethod\.GET\)/);
});
