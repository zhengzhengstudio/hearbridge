const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('web portal exposes a permission-driven responsive shell', () => {
  const auth = read('website/zhengzhengstudio.cn/manager_portal/portal-auth.js');
  const css = read('website/zhengzhengstudio.cn/manager_portal/portal-ui.css');

  assert.match(auth, /PORTAL_NAV_ITEMS/);
  assert.match(auth, /installPortalShell/);
  assert.match(auth, /canOpenPage/);
  assert.match(css, /--zz-radius-panel:\s*12px/);
  assert.match(css, /--zz-radius-control:\s*8px/);
  assert.match(css, /\.portal-shell/);
  assert.match(css, /\.portal-mobile-nav/);
  assert.match(css, /--zz-portal-rail-width:\s*216px/);
  assert.match(css, /padding-inline-start:\s*var\(--zz-portal-rail-width\)/);
  assert.match(css, /@media \(max-width:\s*1024px\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /body\.portal-shell-enabled table\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(auth, /target\.searchParams\.set\('mode', getMode\(\)\)/);
});

test('native apps use platform navigation instead of a six-button action row', () => {
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');

  assert.match(mac, /selectedSection/);
  assert.match(mac, /systemSymbolName/);
  assert.match(ios, /UITabBarDelegate/);
  assert.match(ios, /showTools/);
  assert.match(android, /buildBottomNavigation/);
  assert.match(android, /showTools/);
});

test('feedback is a permission-isolated workflow on web and native clients', () => {
  const server = read('website/api/server.js');
  const auth = read('website/zhengzhengstudio.cn/manager_portal/portal-auth.js');
  const feedback = read('website/zhengzhengstudio.cn/manager_portal/feedback.html');
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');

  for (const permission of ['feedback_view', 'feedback_manage', 'feedback_delete', 'feedback_purge']) {
    assert.match(server, new RegExp(permission));
  }
  assert.match(server, /app\.delete\('\/api\/admin\/feedback\/:id'/);
  assert.match(server, /app\.post\('\/api\/admin\/feedback\/:id\/restore'/);
  assert.match(server, /app\.delete\('\/api\/admin\/feedback\/:id\/purge'/);
  assert.match(auth, /'feedback\.html': 'feedback_view'/);
  assert.match(feedback, /data-required-permission="feedback_view"/);
  assert.doesNotMatch(feedback, /onclick=/);
  assert.match(mac, /showFeedback/);
  assert.match(ios, /showFeedback/);
  assert.match(android, /showFeedback/);
});

test('private app downloads use guarded JSON routes and dynamic cards', () => {
  const server = read('website/api/server.js');
  const portal = read('website/zhengzhengstudio.cn/manager_portal/index.html');

  assert.match(server, /app\.get\('\/api\/admin\/manager\/apps'/);
  assert.match(server, /app\.get\('\/api\/admin\/manager\/apps\/download-token'/);
  assert.match(server, /app\.get\('\/api\/admin\/manager\/apps\/download\/[^']+'/);
  assert.match(server, /isPrivateManagerPackage/);
  assert.match(server, /if \(isPrivateManagerPackage\(fileName\)\)/);
  assert.match(server, /timingSafeEqual/);
  assert.match(portal, /readJsonResponse/);
  assert.match(portal, /manager-apps-grid/);
  assert.match(portal, /createElement\('article'\)/);
  assert.doesNotMatch(portal, /await response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
});

test('native terminal workspaces expose input, separated output, copy and clear actions', () => {
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(mac, /terminalCommandField/);
  assert.match(mac, /terminalStandardOutput/);
  assert.match(mac, /terminalErrorOutput/);
  assert.match(mac, /copyTerminalOutput/);
  assert.match(ios, /terminalCommandField/);
  assert.match(ios, /terminalStandardOutput/);
  assert.match(ios, /terminalErrorOutput/);
  assert.match(ios, /copyTerminalOutput/);
  assert.match(android, /terminalCommandInput/);
  assert.match(android, /terminalStandardOutput/);
  assert.match(android, /terminalErrorOutput/);
  assert.match(android, /copyTerminalOutput/);
  assert.match(harmony, /terminalStandardOutput/);
  assert.match(harmony, /terminalErrorOutput/);
  assert.match(harmony, /copyTerminalOutput/);
  assert.match(harmony, /@ohos\.pasteboard/);
});

test('terminal workspaces use responsive command-first layouts on every platform', () => {
  const web = read('website/zhengzhengstudio.cn/manager_portal/termux_terminal.html');
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const androidManifest = read('apps/ManagerPortal-Android/app/src/main/AndroidManifest.xml');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(web, /class="terminal-layout"/);
  assert.match(web, /class="output-toolbar"/);
  assert.match(web, /toggleOutputWrap/);
  assert.match(web, /statusGrid\.replaceChildren/);
  assert.match(mac, /quickCommands\.orientation = \.horizontal/);
  assert.match(mac, /outputs\.distribution = \.fillEqually/);
  assert.match(ios, /keyboardFrameChanged/);
  assert.match(ios, /quickScroll\.alwaysBounceHorizontal = true/);
  assert.match(ios, /terminalErrorBlock\.isHidden = error\.isEmpty/);
  assert.match(android, /HorizontalScrollView quickScroll/);
  assert.match(android, /IME_ACTION_GO/);
  assert.match(android, /terminalErrorSection\.setVisibility\(error\.length\(\) == 0 \? View\.GONE : View\.VISIBLE\)/);
  assert.match(androidManifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(harmony, /terminalExitStatus/);
  assert.match(harmony, /terminalErrorOutput\.length > 0/);
});

test('feedback records can be copied on every native platform', () => {
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(mac, /copyFeedbackRecord/);
  assert.match(mac, /NSPasteboard\.general/);
  assert.match(ios, /copyFeedbackRecord/);
  assert.match(ios, /UIPasteboard\.general/);
  assert.match(android, /copyFeedbackRecord/);
  assert.match(android, /ClipboardManager/);
  assert.match(harmony, /copyFeedbackRecord/);
});

test('native workspace summary is authenticated and permission filtered', () => {
  const server = read('website/api/server.js');

  assert.match(server, /app\.get\('\/api\/admin\/manager\/workspace-summary'/);
  assert.match(server, /adminHasPermission\(profile, 'system_check'\)/);
  assert.match(server, /adminHasPermission\(profile, 'admin_manage'\)/);
  assert.match(server, /adminHasPermission\(profile, 'logs_view'\)/);
  assert.match(server, /safeAdminForResponse/);
  assert.match(server, /readManagerAppsManifest/);
});

test('native function directory mirrors the main-site permission surface', () => {
  const server = read('website/api/server.js');
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(server, /MANAGER_NATIVE_MODULES/);
  for (const permission of [
    'media_manage', 'works_manage', 'downloads_manage', 'documents_manage',
    'websites_manage', 'festival_manage', 'feedback_view', 'security_manage',
    'system_check', 'termux_terminal', 'code_edit', 'admin_manage', 'user_insights'
  ]) {
    assert.match(server, new RegExp(permission));
  }
  assert.match(server, /modules:\s*MANAGER_NATIVE_MODULES\.filter/);
  assert.match(server, /app\.get\('\/api\/admin\/manager\/module-data\/:moduleId'/);
  assert.match(server, /MANAGER_NATIVE_MODULES\.find\(item => item\.id === req\.params\.moduleId\)/);
  assert.match(server, /adminHasPermission\(profile, module\.permission\)/);
  assert.match(mac, /renderNativeModules/);
  assert.match(ios, /renderNativeModules/);
  assert.match(android, /renderNativeModules/);
  assert.match(harmony, /nativeModules/);
  assert.match(mac, /showNativeModuleWorkspace/);
  assert.match(ios, /showNativeModuleWorkspace/);
  assert.match(android, /showNativeModuleWorkspace/);
  assert.match(harmony, /NativeModuleView/);
  assert.doesNotMatch(mac, /manager_portal\/\\\(page\\\)/);
  assert.doesNotMatch(ios, /manager_portal\/\\\(page\\\)/);
  assert.doesNotMatch(android, /manager_portal\/" \+ page/);
  assert.doesNotMatch(harmony, /manager_portal\/\$\{item\.page\}/);
});

test('automatic update checks surface an in-app prompt and hand off to system installers', () => {
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(mac, /managerLastUpdatePromptBuild/);
  assert.match(mac, /presentUpdatePrompt/);
  assert.match(mac, /NSWorkspace\.shared\.open/);
  assert.match(ios, /managerLastUpdatePromptBuild/);
  assert.match(ios, /presentUpdatePrompt/);
  assert.match(ios, /openInstallEntry/);
  assert.match(android, /managerLastUpdatePromptBuild/);
  assert.match(android, /showUpdateDialog/);
  assert.match(android, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(android, /pendingInstallUri/);
  assert.match(harmony, /updateAvailable/);
  assert.match(harmony, /downloadManagerUpdate/);
  assert.match(harmony, /@ohos\.request/);
  assert.match(harmony, /@ohos\.file\.fileuri/);
  assert.match(harmony, /ACTION_VIEW_DATA/);
});

test('permission checks bind to verified token identity instead of trusted network headers', () => {
  const server = read('website/api/server.js');
  const authStart = server.indexOf('const authAdmin =');
  const authEnd = server.indexOf("app.use('/api/hap-installer'", authStart);
  const authAdmin = server.slice(authStart, authEnd);
  const profileStart = server.indexOf('async function getRequestAdminProfile');
  const profileEnd = server.indexOf('function adminHasPermission', profileStart);
  const profileResolver = server.slice(profileStart, profileEnd);
  const permissionStart = server.indexOf('function requireAdminPermission');
  const permissionEnd = server.indexOf('const ADMIN_INPUT_BLOCKED_KEYS', permissionStart);
  const permissionGuard = server.slice(permissionStart, permissionEnd);

  assert.doesNotMatch(authAdmin, /req\.isWhitelisted|adminTrustedNetwork|Trusted network access granted/);
  assert.match(profileResolver, /const username = req\.adminUsername/);
  assert.doesNotMatch(profileResolver, /x-admin-username|req\.body\?\.username/);
  assert.match(permissionGuard, /if \(!req\.adminUsername/);
  assert.match(permissionGuard, /status\(401\)/);
});

test('HarmonyOS restores canonical super-admin role and permissions from the server session', () => {
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(harmony, /@State role: string = ''/);
  assert.match(harmony, /request\('\/api\/admin\/session'/);
  assert.match(harmony, /this\.role === 'super'/);
  assert.match(harmony, /this\.role = String\(json\['role'\]/);
  assert.match(harmony, /this\.permissions = \(json\['permissions'\] as string\[\]\)/);
});

test('native admin status actions enforce hierarchy on the server and exist on every client', () => {
  const server = read('website/api/server.js');
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(server, /app\.put\('\/api\/admin\/admins\/:username\/status'/);
  assert.match(server, /requireAdminPermission\('admin_manage'\)/);
  assert.match(server, /canManageAdminTarget\(actorProfile, targetProfile\)/);
  assert.match(server, /\['active', 'disabled'\]\.includes\(status\)/);
  assert.match(mac, /updateAdminStatus/);
  assert.match(ios, /updateAdminStatus/);
  assert.match(android, /updateAdminStatus/);
  assert.match(harmony, /updateAdminStatus/);
});

test('native apps separate overview from the permission-driven operations workspace', () => {
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(mac, /showOperations/);
  assert.match(mac, /workspace-summary/);
  assert.match(ios, /showOperations/);
  assert.match(ios, /workspace-summary/);
  assert.match(android, /showOperations/);
  assert.match(android, /workspace-summary/);
  assert.match(harmony, /OperationsView/);
  assert.match(harmony, /workspace-summary/);

  const macDashboard = mac.slice(mac.indexOf('private func showDashboard()'), mac.indexOf('private func showNotices'));
  const iosDashboard = ios.slice(ios.indexOf('private func showDashboard()'), ios.indexOf('private func logout()'));
  const androidDashboard = android.slice(android.indexOf('private void showDashboard()'), android.indexOf('private void showNotices()'));
  assert.doesNotMatch(macDashboard, /showTerminalStatus\(inline: true\)|showInsights\(inline: true\)/);
  assert.doesNotMatch(iosDashboard, /showTerminal\(inline: true\)|showInsights\(inline: true\)/);
  assert.doesNotMatch(androidDashboard, /addTerminal\(true\)|addInsights\(true\)/);
});

test('all native package metadata uses version 1.5.5 build 17 and includes HarmonyOS', () => {
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const gradle = read('apps/ManagerPortal-Android/app/build.gradle.kts');
  const harmonyApp = read('apps/ManagerPortal-HarmonyOS/AppScope/app.json5');
  const harmonyPage = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');
  const build = read('apps/build_manager_portal_apps.sh');

  assert.match(mac, /appVersion\s*=\s*"1\.5\.5"/);
  assert.match(ios, /appVersion\s*=\s*"1\.5\.5"/);
  assert.match(gradle, /versionCode\s*=\s*17/);
  assert.match(gradle, /versionName\s*=\s*"1\.5\.5"/);
  assert.match(harmonyApp, /"versionName":\s*"1\.5\.5"/);
  assert.match(harmonyApp, /"versionCode":\s*1050517/);
  assert.match(harmonyPage, /@ohos\.net\.http/);
  assert.doesNotMatch(harmonyPage, /Web\(|Webview|ArkWeb/);
  assert.match(build, /VERSION="1\.5\.5"/);
  assert.match(build, /BUILD="17"/);
  assert.match(build, /manager-portal-harmony/);
});

test('insights alerts logs and updates open structured workspaces instead of raw JSON', () => {
  const server = read('website/api/server.js');
  const web = read('website/zhengzhengstudio.cn/manager_portal/index.html');
  const mac = read('apps/ManagerPortalMac/Sources/main.swift');
  const ios = read('apps/ManagerPortal-iOS/Sources/main.swift');
  const android = read('apps/ManagerPortal-Android/app/src/main/java/com/zzsys/managerportal/NativeMainActivity.java');
  const harmony = read('apps/ManagerPortal-HarmonyOS/entry/src/main/ets/pages/Index.ets');

  assert.match(server, /app\.get\('\/api\/admin\/user-insights'/);
  assert.match(server, /app\.get\('\/api\/admin\/manager\/alerts'/);
  assert.match(server, /app\.get\('\/api\/admin\/manager\/logs'/);
  assert.match(server, /requireAdminPermission\('alerts_manage'\)/);
  assert.match(web, /openObservabilityPanel/);
  assert.match(web, /updateManagerAlert/);
  assert.match(web, /loadManagerLogs/);
  assert.match(mac, /showAlerts/);
  assert.match(mac, /showLogs/);
  assert.match(mac, /showAppsWorkspace/);
  assert.match(ios, /showAlerts/);
  assert.match(ios, /showLogs/);
  assert.match(ios, /showUpdateDetails/);
  assert.match(android, /showAlerts/);
  assert.match(android, /showLogs/);
  assert.match(android, /showUpdateDetails/);
  assert.match(harmony, /InsightsView/);
  assert.match(harmony, /AlertsView/);
  assert.match(harmony, /LogsView/);
  assert.match(harmony, /item\.id === 'insights'\) \{ this\.openInsights\(\)/);
  assert.match(harmony, /item\.id === 'alerts'\) \{ this\.openAlerts\(\)/);
  assert.match(harmony, /item\.id === 'logs'\) \{ this\.openLogs\(\)/);
});

test('H5 manager home is task-first, permission-safe and bounded on mobile', () => {
  const web = read('website/zhengzhengstudio.cn/manager_portal/index.html');
  const h5 = read('website/zhengzhengstudio.cn/manager_portal/portal-home-h5.css');
  const sharedH5 = read('website/zhengzhengstudio.cn/manager_portal/portal-h5-shared.css');

  assert.match(web, /portal-home-h5\.css\?v=20260828-1/);
  assert.match(web, /id="h5-entry-toggle"/);
  assert.match(web, /card\.style\.display !== 'none'/);
  assert.match(web, /index >= 8/);
  assert.match(web, /manager-permissions-applied/);
  assert.match(web, /Number\.isFinite\(uptimeSeconds\)/);
  assert.match(web, /countData\.onlineCount \?\? countData\.count \?\? 0/);
  assert.match(web, /if \(name !== 'apps' && item !== panel\) item\.style\.display = 'none'/);

  assert.match(h5, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(h5, /selection-card\[style\*="display: none"\]/);
  assert.match(h5, /#global-monitor > \.stats-grid[\s\S]*display: flex/);
  assert.match(h5, /height: 60px/);
  assert.match(h5, /overflow-x: clip/);
  assert.match(sharedH5, /padding-bottom: calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(sharedH5, /overscroll-behavior-inline: contain/);
});
