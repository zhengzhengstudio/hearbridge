import http from '@ohos.net.http'
import preferences from '@ohos.data.preferences'
import pasteboard from '@ohos.pasteboard'
import downloadRequest from '@ohos.request'
import fileuri from '@ohos.file.fileuri'
import wantConstant from '@ohos.ability.wantConstant'
import { common } from '@kit.AbilityKit'

interface FeedbackItem {
  id: string
  product: string
  platform: string
  account: string
  contact: string
  category: string
  message: string
  status: string
  note: string
  createdAt: string
}

interface WorkspaceAdmin {
  username: string
  role: string
  status: string
  permissionCount: number
  manageable: boolean
}

interface WorkspaceAudit {
  timestamp: string
  username: string
  action: string
  result: string
}

interface WorkspaceApp {
  id: string
  platform: string
  platformLabel: string
  version: string
  build: number
  available: boolean
  fileName: string
}

interface NativeModule {
  id: string
  label: string
  group: string
  permission: string
  endpoint: string
}

interface ContentChoice {
  value: string
  label: string
}

interface ContentField {
  key: string
  label: string
  type: string
  value: string
  editable: boolean
  required: boolean
  maxLength: number
  options: ContentChoice[]
}

interface ContentRecord {
  id: string
  group: string
  title: string
  subtitle: string
  revision: string
  fields: ContentField[]
  actions: string[]
}

interface ContentWorkspace {
  module: string
  canCreate: boolean
  createFields: ContentField[]
  records: ContentRecord[]
}

interface ContentRequestResult {
  statusCode: number
  body: Record<string, Object>
  error: string
  requestToken: string
  requestUsername: string
}

interface ContentEditorState {
  active: boolean
  action: string
  moduleId: string
  recordId: string
  revision: string
  title: string
  fields: ContentField[]
  values: Record<string, string>
  isSaving: boolean
  error: string
}

@Entry
@Component
struct Index {
  @State username: string = ''
  @State password: string = ''
  @State token: string = ''
  @State role: string = ''
  @State permissions: string[] = []
  @State loginMode: number = 0
  @State selectedTab: number = 0
  @State statusText: string = '请登录'
  @State isBusy: boolean = false
  @State onlineCount: number = 0
  @State userCount: number = 0
  @State memoryMB: number = 0
  @State uptimeHours: number = 0
  @State updateText: string = '正在检查版本'
  @State updateAvailable: boolean = false
  @State updateVersion: string = ''
  @State updateBuild: number = 0
  @State updateFileName: string = ''
  @State feedbackItems: FeedbackItem[] = []
  @State feedbackSummary: string = '暂无反馈数据'
  @State workspaceError: string = ''
  @State workspaceAdmins: WorkspaceAdmin[] = []
  @State workspaceAudit: WorkspaceAudit[] = []
  @State workspaceApps: WorkspaceApp[] = []
  @State nativeModules: NativeModule[] = []
  @State selectedModuleTitle: string = ''
  @State nativeModuleError: string = ''
  @State contentWorkspace: ContentWorkspace = { module: '', canCreate: false, createFields: [], records: [] }
  @State contentEditor: ContentEditorState = {
    active: false, action: '', moduleId: '', recordId: '', revision: '', title: '', fields: [], values: {}, isSaving: false, error: ''
  }
  @State editorChoiceValues: Record<string, string[]> = {}
  @State toolMode: number = 0
  @State terminalStatus: string = '尚未连接 Termux'
  @State command: string = 'pm2 status'
  @State terminalStandardOutput: string = ''
  @State terminalErrorOutput: string = ''
  private contentWorkspaceCache: Record<string, ContentWorkspace> = {}
  private contentGeneration: number = 0
  private contentWorkspaceGeneration: number = 0
  private contentWorkspaceModuleId: string = ''
  private readonly baseURL: string = 'https://zhengzhengstudio.cn'
  private readonly appBuild: number = 14

  aboutToAppear(): void {
    this.restoreSession()
  }

  private context(): common.UIAbilityContext {
    return getContext(this) as common.UIAbilityContext
  }

  private hasPermission(permission: string): boolean {
    return this.role === 'super' || this.permissions.includes('*') || this.permissions.includes(permission)
  }

  private async restoreSession(): Promise<void> {
    let store = await preferences.getPreferences(this.context(), 'manager_portal_session')
    this.username = await store.get('username', '') as string
    this.token = await store.get('token', '') as string
    this.role = await store.get('role', '') as string
    let saved = await store.get('permissions', '[]') as string
    try {
      this.permissions = JSON.parse(saved) as string[]
    } catch (_) {
      this.permissions = []
    }
    if (this.token.length > 0) {
      this.statusText = '正在恢复会话'
      try {
        let json = await this.request('/api/admin/session', http.RequestMethod.GET)
        this.username = String(json['username'] || this.username)
        this.role = String(json['role'] || '')
        this.permissions = (json['permissions'] as string[]) || []
        await this.saveSession()
        await this.loadWorkspace()
      } catch (_) {
        await this.clearSession()
        this.statusText = '会话已过期，请重新登录'
      }
    }
  }

  private async saveSession(): Promise<void> {
    let store = await preferences.getPreferences(this.context(), 'manager_portal_session')
    await store.put('username', this.username)
    await store.put('token', this.token)
    await store.put('role', this.role)
    await store.put('permissions', JSON.stringify(this.permissions))
    await store.flush()
  }

  private async clearSession(): Promise<void> {
    let store = await preferences.getPreferences(this.context(), 'manager_portal_session')
    await store.clear()
    await store.flush()
    this.token = ''
    this.role = ''
    this.password = ''
    this.permissions = []
    this.resetContentWorkspaceState()
    this.selectedTab = 0
    this.statusText = '已退出'
  }

  private parseJsonResponse(result: http.HttpResponse, label: string): Record<string, Object> {
    let body = String(result.result || '').trim()
    if (result.responseCode < 200 || result.responseCode >= 300) {
      if (body.startsWith('{')) {
        let errorBody = JSON.parse(body) as Record<string, Object>
        throw new Error(String(errorBody['error'] || `${label}失败`))
      }
      throw new Error(`${label}失败（HTTP ${result.responseCode}）`)
    }
    if (!body.startsWith('{')) {
      throw new Error(`${label}返回了网页而不是数据`)
    }
    try {
      return JSON.parse(body) as Record<string, Object>
    } catch (_) {
      throw new Error(`${label}数据格式错误`)
    }
  }

  private async request(path: string, method: http.RequestMethod,
    body?: Record<string, Object>, authenticated: boolean = true): Promise<Record<string, Object>> {
    let client = http.createHttp()
    let header: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Manager-Native': 'ManagerPortal/HarmonyOS-1.5.2'
    }
    if (authenticated && this.token.length > 0) {
      header['x-admin-username'] = encodeURIComponent(this.username)
      header['x-admin-token'] = this.token
    }
    try {
      let options: http.HttpRequestOptions = {
        method: method,
        header: header,
        connectTimeout: 10000,
        readTimeout: 15000
      }
      if (body) options.extraData = JSON.stringify(body)
      let result = await client.request(`${this.baseURL}${path}`, options)
      return this.parseJsonResponse(result, '服务器请求')
    } finally {
      client.destroy()
    }
  }

  private async login(): Promise<void> {
    if (this.username.trim().length === 0 || this.password.length === 0) {
      this.statusText = '请输入账号和密码'
      return
    }
    this.isBusy = true
    this.statusText = '正在验证'
    try {
      if (this.loginMode === 0) {
        let payload: Record<string, Object> = {
          'username': this.username.trim(),
          'password': this.password,
          'managerCompat': true
        }
        let json = await this.request('/api/admin/verify-password', http.RequestMethod.POST, payload, false)
        if (json['success'] !== true) throw new Error(String(json['error'] || '账号或密码错误'))
        this.token = String(json['token'] || '')
        this.role = String(json['role'] || '')
        this.permissions = (json['permissions'] as string[]) || []
      } else {
        let passport = await this.request('/api/auth/login', http.RequestMethod.POST, {
          'username': this.username.trim(),
          'password': this.password,
          'managerCompat': true
        }, false)
        let user = passport['user'] as Record<string, Object>
        if (!user) throw new Error(String(passport['error'] || '通行证验证失败'))
        let uid = String(user['uid'] || user['id'] || '')
        let authToken = String(user['authToken'] || '')
        let admin = await this.request('/api/admin/passport-login', http.RequestMethod.POST, {
          'passportUid': uid,
          'authToken': authToken,
          'managerCompat': true
        }, false)
        if (admin['success'] !== true) throw new Error(String(admin['error'] || '该通行证没有管理员权限'))
        this.username = String(admin['username'] || this.username)
        this.token = String(admin['token'] || '')
        this.role = String(admin['role'] || '')
        this.permissions = (admin['permissions'] as string[]) || []
      }
      if (this.token.length === 0) throw new Error('登录响应缺少授权 token')
      this.password = ''
      await this.saveSession()
      await this.loadWorkspace()
      this.statusText = '已连接'
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : '登录失败'
      this.token = ''
    } finally {
      this.isBusy = false
    }
  }

  private async loadWorkspace(): Promise<void> {
    this.isBusy = true
    try {
      await this.loadWorkspaceSummary()
      if (this.hasPermission('feedback_view')) await this.loadFeedback()
      if (this.hasPermission('termux_terminal')) await this.loadTerminalStatus()
      await this.checkUpdate()
    } catch (error) {
      let message = error instanceof Error ? error.message : '刷新失败'
      this.statusText = message
      this.workspaceError = message
      if (message.includes('会话') || message.includes('授权') || message.includes('401')) await this.clearSession()
    } finally {
      this.isBusy = false
    }
  }

  private async loadWorkspaceSummary(): Promise<void> {
    let json = await this.request('/api/admin/manager/workspace-summary', http.RequestMethod.GET)
    let system = json['system'] as Record<string, Object>
    if (system) {
      this.onlineCount = Number(system['online'] || 0)
      this.userCount = Number(system['unifiedUsers'] || 0)
      this.memoryMB = Number(system['memoryMB'] || 0)
      this.uptimeHours = Math.floor(Number(system['uptime'] || 0) / 3600)
    }
    this.workspaceAdmins = (json['admins'] as WorkspaceAdmin[]) || []
    this.workspaceAudit = (json['audit'] as WorkspaceAudit[]) || []
    this.workspaceApps = (json['apps'] as WorkspaceApp[]) || []
    this.nativeModules = (json['modules'] as NativeModule[]) || []
    let current = this.workspaceApps.find((item: WorkspaceApp) => item.id === 'manager-portal-harmony')
    this.updateText = current && current.build > this.appBuild
      ? `可更新至 ${current.version}（build ${current.build}）`
      : '1.5.2 · 已是最新版本'
    this.workspaceError = ''
  }

  private async updateAdminStatus(item: WorkspaceAdmin): Promise<void> {
    if (!this.hasPermission('admin_manage') || !item.manageable) return
    let nextStatus = item.status === 'active' ? 'disabled' : 'active'
    this.isBusy = true
    try {
      await this.request(`/api/admin/admins/${encodeURIComponent(item.username)}/status`, http.RequestMethod.PUT, {
        'status': nextStatus
      })
      this.statusText = nextStatus === 'active' ? '管理员已启用' : '管理员已停用'
      await this.loadWorkspaceSummary()
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : '管理员状态更新失败'
    } finally {
      this.isBusy = false
    }
  }

  private async loadStats(): Promise<void> {
    let json = await this.request('/api/admin/stats', http.RequestMethod.GET)
    let counts = json['counts'] as Record<string, Object>
    let memory = json['memory'] as Record<string, Object>
    this.onlineCount = Number(counts ? counts['online'] : 0)
    this.userCount = Number(counts ? counts['unifiedUsers'] : 0)
    this.memoryMB = Math.round(Number(memory ? memory['rss'] : 0) / 1024 / 1024)
    this.uptimeHours = Math.round(Number(json['uptime'] || 0) / 3600)
  }

  private async loadFeedback(): Promise<void> {
    let json = await this.request('/api/admin/feedback?limit=30', http.RequestMethod.GET)
    this.feedbackItems = (json['feedback'] as FeedbackItem[]) || []
    let summary = json['summary'] as Record<string, Object>
    this.feedbackSummary = summary
      ? `新反馈 ${Number(summary['new'] || 0)} · 处理中 ${Number(summary['reviewing'] || 0)} · 已解决 ${Number(summary['resolved'] || 0)}`
      : `${this.feedbackItems.length} 条反馈`
  }

  private async updateFeedback(item: FeedbackItem, status: string): Promise<void> {
    if (!this.hasPermission('feedback_manage')) return
    try {
      await this.request(`/api/admin/feedback/${encodeURIComponent(item.id)}`, http.RequestMethod.PUT, {
        'status': status,
        'note': item.note || ''
      })
      await this.loadFeedback()
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : '反馈更新失败'
    }
  }

  private async loadTerminalStatus(): Promise<void> {
    let json = await this.request('/api/admin/termux/status', http.RequestMethod.GET)
    let status = json['status'] as Record<string, Object>
    this.terminalStatus = status
      ? `${String(status['hostname'] || 'Termux')} · Node ${String(status['node'] || '-')} · ${String(status['arch'] || '-')}`
      : 'Termux 状态不可用'
  }

  private async runCommand(): Promise<void> {
    if (!this.hasPermission('termux_terminal') || this.command.trim().length === 0) return
    this.isBusy = true
    this.terminalStandardOutput = '正在执行...'
    this.terminalErrorOutput = ''
    try {
      let json = await this.request('/api/admin/termux/command', http.RequestMethod.POST, {
        'command': this.command.trim(),
        'timeoutMs': 15000
      })
      this.terminalStandardOutput = String(json['stdout'] || '').trim()
      this.terminalErrorOutput = String(json['stderr'] || json['error'] || '').trim()
      this.statusText = json['exitCode'] === undefined
        ? '命令已结束'
        : `命令已结束，退出码 ${Number(json['exitCode'])}`
    } catch (error) {
      this.terminalStandardOutput = ''
      this.terminalErrorOutput = error instanceof Error ? error.message : '命令执行失败'
      this.statusText = '命令执行失败'
    } finally {
      this.isBusy = false
    }
  }

  private async copyText(label: string, value: string): Promise<void> {
    try {
      let data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, value)
      await pasteboard.getSystemPasteboard().setData(data)
      this.statusText = `${label}已复制`
    } catch (_) {
      this.statusText = `${label}复制失败`
    }
  }

  private async copyFeedbackRecord(item: FeedbackItem): Promise<void> {
    let record = [
      `反馈编号：${item.id || '-'}`,
      `产品：${item.product || '-'}`,
      `平台：${item.platform || '-'}`,
      `账号：${item.account || '匿名'}`,
      `联系方式：${item.contact || '-'}`,
      `分类：${item.category || '体验反馈'}`,
      `状态：${item.status || 'new'}`,
      `内容：${item.message || ''}`,
      `内部备注：${item.note || '-'}`,
      `提交时间：${item.createdAt || '-'}`
    ].join('\n')
    await this.copyText('反馈记录', record)
  }

  private async copyTerminalOutput(): Promise<void> {
    await this.copyText('终端输出', `$ ${this.command}\n[标准输出]\n${this.terminalStandardOutput}\n[错误输出]\n${this.terminalErrorOutput}`)
  }

  private clearTerminalOutput(): void {
    this.terminalStandardOutput = ''
    this.terminalErrorOutput = ''
    this.statusText = '输出已清空'
  }

  private async checkUpdate(): Promise<void> {
    let json = await this.request('/api/admin/manager/apps', http.RequestMethod.GET)
    let apps = (json['apps'] as Array<Record<string, Object>>) || []
    let app = apps.find((item: Record<string, Object>) => String(item['id']) === 'manager-portal-harmony')
    if (app && Number(app['build'] || 0) > this.appBuild) {
      this.updateAvailable = true
      this.updateVersion = String(app['version'] || '')
      this.updateBuild = Number(app['build'] || 0)
      this.updateFileName = String(app['fileName'] || '')
      this.updateText = `可更新至 ${this.updateVersion}（build ${this.updateBuild}）`
      let store = await preferences.getPreferences(this.context(), 'manager_portal_session')
      let promptedBuild = await store.get('managerLastUpdatePromptBuild', 0) as number
      if (promptedBuild !== this.updateBuild) {
        await store.put('managerLastUpdatePromptBuild', this.updateBuild)
        await store.flush()
        AlertDialog.show({
          title: '发现新版本',
          message: `铮铮控制台 ${this.updateVersion} 已发布。安装包会下载到应用文件目录，然后交给系统安装器。`,
          primaryButton: { value: '下载并安装', action: () => this.downloadManagerUpdate() },
          secondaryButton: { value: '稍后', action: () => {} }
        })
      }
    } else {
      this.updateAvailable = false
      this.updateVersion = ''
      this.updateBuild = 0
      this.updateFileName = ''
      this.updateText = '1.5.2 · 已是最新版本'
    }
  }

  private async downloadManagerUpdate(): Promise<void> {
    if (!this.updateAvailable || this.updateFileName.length === 0 || this.isBusy) return
    this.isBusy = true
    this.statusText = '正在准备更新'
    try {
      let ticket = await this.request(`/api/admin/manager/apps/download-token?file=${encodeURIComponent(this.updateFileName)}`, http.RequestMethod.GET)
      let downloadPath = String(ticket['downloadURL'] || '')
      if (downloadPath.length === 0) throw new Error('生成下载票据失败')
      let downloadURL = downloadPath.startsWith('http') ? downloadPath : `${this.baseURL}${downloadPath}`
      let filePath = `${this.context().filesDir}/${this.updateFileName}`
      let task = await downloadRequest.downloadFile(this.context(), {
        url: downloadURL,
        filePath: filePath,
        title: `铮铮控制台 ${this.updateVersion}`,
        description: '正在下载安装包',
        background: true
      })
      this.statusText = '正在下载安装包'
      task.on('progress', (receivedSize: number, totalSize: number) => {
        if (totalSize > 0) this.statusText = `正在下载 ${Math.floor(receivedSize * 100 / totalSize)}%`
      })
      task.on('complete', () => {
        this.statusText = '下载完成，正在打开系统安装器'
        let uri = fileuri.getUriFromPath(filePath)
        this.context().startAbility({
          action: wantConstant.Action.ACTION_VIEW_DATA,
          uri: uri,
          type: 'application/vnd.harmonyos.hap',
          flags: wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION
        }).catch(() => this.statusText = '系统安装器无法打开，请检查安装包签名')
        this.isBusy = false
      })
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : '更新下载失败'
      this.isBusy = false
    }
  }

  private openNativeModule(item: NativeModule): void {
    if (item.id === 'feedback') { this.selectedTab = 1; return }
    if (item.id === 'terminal') { this.toolMode = 1; this.selectedTab = 2; return }
    if (item.id === 'system' || item.id === 'security' || item.id === 'admins') {
      this.toolMode = 0
      this.selectedTab = 2
      return
    }
    if (this.isContentModule(item.id)) {
      this.showContentWorkspace(item)
      return
    }
    this.showNativeModuleWorkspace(item)
  }

  private async showNativeModuleWorkspace(item: NativeModule): Promise<void> {
    this.contentGeneration += 1
    this.contentWorkspaceGeneration = this.contentGeneration
    this.contentWorkspaceModuleId = ''
    this.contentWorkspace = this.emptyContentWorkspace()
    this.contentEditor = this.emptyContentEditor()
    this.selectedModuleTitle = item.label
    this.nativeModuleError = '该模块暂不提供原生内容编辑。'
    this.toolMode = 2
    this.selectedTab = 2
  }

  private isContentModule(moduleId: string): boolean {
    return ['media', 'downloads', 'documents', 'websites', 'works'].includes(moduleId)
  }

  private isContentAction(action: string): boolean {
    return ['create', 'update', 'delete'].includes(action)
  }

  private emptyContentWorkspace(): ContentWorkspace {
    return { module: '', canCreate: false, createFields: [], records: [] }
  }

  private emptyContentEditor(): ContentEditorState {
    return {
      active: false, action: '', moduleId: '', recordId: '', revision: '', title: '', fields: [], values: {}, isSaving: false, error: ''
    }
  }

  private resetContentWorkspaceState(): void {
    this.contentGeneration += 1
    this.contentWorkspaceCache = {}
    this.contentWorkspaceModuleId = ''
    this.contentWorkspaceGeneration = this.contentGeneration
    this.contentWorkspace = this.emptyContentWorkspace()
    this.contentEditor = this.emptyContentEditor()
    this.editorChoiceValues = {}
    this.nativeModuleError = ''
  }

  private beginContentWorkspace(moduleId: string): number {
    this.contentGeneration += 1
    this.contentWorkspaceGeneration = this.contentGeneration
    this.contentWorkspaceModuleId = moduleId
    return this.contentGeneration
  }

  private isCurrentContentWorkspace(moduleId: string, generation: number): boolean {
    return this.token.length > 0 && this.toolMode === 2 && this.selectedTab === 2 &&
      this.contentWorkspaceModuleId === moduleId && this.contentWorkspaceGeneration === generation
  }

  private parseContentChoice(input: Record<string, Object>): ContentChoice {
    return {
      value: String(input['value'] || ''),
      label: String(input['label'] || input['value'] || '未分类')
    }
  }

  private parseContentField(input: Record<string, Object>): ContentField {
    let rawOptions = input['options']
    let options: ContentChoice[] = []
    if (Array.isArray(rawOptions)) {
      options = (rawOptions as Record<string, Object>[]).map((option: Record<string, Object>) => this.parseContentChoice(option))
    }
    return {
      key: String(input['key'] || ''),
      label: String(input['label'] || input['key'] || '字段'),
      type: String(input['type'] || 'text'),
      value: String(input['value'] || ''),
      editable: input['editable'] === true,
      required: input['required'] === true,
      maxLength: Number(input['maxLength'] || 0),
      options: options
    }
  }

  private parseContentRecord(input: Record<string, Object>): ContentRecord {
    let rawFields = input['fields']
    let rawActions = input['actions']
    let fields = Array.isArray(rawFields)
      ? (rawFields as Record<string, Object>[]).map((field: Record<string, Object>) => this.parseContentField(field))
      : []
    let actions = Array.isArray(rawActions) ? (rawActions as Object[]).map((action: Object) => String(action)) : []
    return {
      id: String(input['id'] || ''), group: String(input['group'] || ''), title: String(input['title'] || input['id'] || ''),
      subtitle: String(input['subtitle'] || ''), revision: String(input['revision'] || ''), fields: fields, actions: actions
    }
  }

  private parseContentWorkspace(input: Record<string, Object>, moduleId: string): ContentWorkspace {
    let rawRecords = input['records']
    let rawCreateFields = input['createFields']
    let records = Array.isArray(rawRecords)
      ? (rawRecords as Record<string, Object>[]).map((record: Record<string, Object>) => this.parseContentRecord(record))
      : []
    let createFields = Array.isArray(rawCreateFields)
      ? (rawCreateFields as Record<string, Object>[]).map((field: Record<string, Object>) => this.parseContentField(field))
      : []
    return {
      module: String(input['module'] || moduleId), canCreate: input['canCreate'] === true,
      createFields: createFields, records: records
    }
  }

  private async contentRequest(moduleId: string, operation: string,
    body?: Record<string, Object>): Promise<ContentRequestResult> {
    let requestToken = this.token
    let requestUsername = this.username
    if (!this.isContentModule(moduleId) || (operation !== 'read' && operation !== 'submit')) {
      return { statusCode: 400, body: {}, error: '不支持的内容请求', requestToken: requestToken, requestUsername: requestUsername }
    }
    let path = `/api/admin/manager/content/${encodeURIComponent(moduleId)}`
    let method = http.RequestMethod.GET
    if (operation === 'submit') {
      path = `/api/admin/manager/content/${encodeURIComponent(moduleId)}/action`
      method = http.RequestMethod.POST
    }
    let client = http.createHttp()
    try {
      let options: http.HttpRequestOptions = {
        method: method,
        header: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Manager-Native': 'ManagerPortal/HarmonyOS-1.5.2',
          'x-admin-username': encodeURIComponent(requestUsername),
          'x-admin-token': requestToken
        },
        connectTimeout: 10000,
        readTimeout: 15000
      }
      if (body) options.extraData = JSON.stringify(body)
      let response = await client.request(`${this.baseURL}${path}`, options)
      let raw = String(response.result || '').trim()
      let resultBody: Record<string, Object> = {}
      if (!raw.startsWith('{')) {
        return {
          statusCode: response.responseCode, body: {}, error: '服务器返回了网页而不是数据',
          requestToken: requestToken, requestUsername: requestUsername
        }
      }
      try {
        resultBody = JSON.parse(raw) as Record<string, Object>
      } catch (_) {
        return { statusCode: response.responseCode, body: {}, error: '服务器数据格式错误', requestToken: requestToken, requestUsername: requestUsername }
      }
      let error = String(resultBody['error'] || '')
      if (error.length === 0 && (response.responseCode < 200 || response.responseCode >= 300)) {
        error = raw.length > 0 ? `服务器请求失败（HTTP ${response.responseCode}）` : `服务器请求失败（HTTP ${response.responseCode}）`
      }
      return { statusCode: response.responseCode, body: resultBody, error: error, requestToken: requestToken, requestUsername: requestUsername }
    } catch (error) {
      return {
        statusCode: 0, body: {}, error: error instanceof Error ? error.message : '网络请求失败',
        requestToken: requestToken, requestUsername: requestUsername
      }
    } finally {
      client.destroy()
    }
  }

  private async handleContentResult(result: ContentRequestResult): Promise<boolean> {
    if (result.statusCode === 401) {
      if (this.token === result.requestToken && this.username === result.requestUsername) {
        await this.clearSession()
        this.statusText = '会话已过期，请重新登录'
      }
      return false
    }
    if (result.statusCode === 403) {
      this.statusText = result.error || '当前账号没有该模块权限'
      return false
    }
    if (result.statusCode < 200 || result.statusCode >= 300 || result.body['success'] === false) {
      this.statusText = result.error || '内容操作失败'
      return false
    }
    return true
  }

  private async showContentWorkspace(item: NativeModule): Promise<void> {
    if (!this.isContentModule(item.id)) return
    let moduleId = item.id
    let generation = this.beginContentWorkspace(moduleId)
    this.selectedModuleTitle = item.label
    this.nativeModuleError = ''
    this.contentEditor = this.emptyContentEditor()
    this.toolMode = 2
    this.selectedTab = 2
    let cached = this.contentWorkspaceCache[moduleId]
    this.contentWorkspace = cached ? cached : this.emptyContentWorkspace()
    let result = await this.contentRequest(moduleId, 'read')
    if (result.statusCode === 401) {
      await this.handleContentResult(result)
      return
    }
    if (!this.isCurrentContentWorkspace(moduleId, generation)) return
    if (!await this.handleContentResult(result)) {
      this.nativeModuleError = result.error || this.statusText
      return
    }
    let workspace = this.parseContentWorkspace(result.body['workspace'] as Record<string, Object>, moduleId)
    if (workspace.module !== moduleId) {
      this.nativeModuleError = '内容工作区与当前模块不一致'
      return
    }
    this.contentWorkspaceCache[moduleId] = workspace
    this.contentWorkspace = workspace
    this.statusText = `${workspace.records.length} 条${item.label}记录`
  }

  private openContentEditor(action: string, record?: ContentRecord): void {
    if (!this.isContentAction(action) || !this.isContentModule(this.contentWorkspace.module)) return
    if (action === 'create' && !this.contentWorkspace.canCreate) return
    if (action !== 'create' && !record) return
    let fields = action === 'create' ? this.contentWorkspace.createFields : record!.fields
    let values: Record<string, string> = {}
    let choices: Record<string, string[]> = {}
    fields.forEach((field: ContentField) => {
      values[field.key] = field.value
      if (field.type === 'choice') choices[field.key] = field.options.map((option: ContentChoice) => option.value)
    })
    this.editorChoiceValues = choices
    this.contentEditor = {
      active: true, action: action, moduleId: this.contentWorkspace.module,
      recordId: record ? record.id : '', revision: record ? record.revision : '',
      title: action === 'create' ? `新建${this.selectedModuleTitle}` : `编辑${record!.title}`,
      fields: fields, values: values, isSaving: false, error: ''
    }
  }

  private closeContentEditor(): void {
    if (this.contentEditor.isSaving) return
    this.contentEditor = this.emptyContentEditor()
    this.editorChoiceValues = {}
  }

  private editorValue(key: string): string {
    return this.contentEditor.values[key] || ''
  }

  private copyEditorValues(source: Record<string, string>): Record<string, string> {
    let values: Record<string, string> = {}
    Object.keys(source).forEach((key: string) => {
      values[key] = source[key]
    })
    return values
  }

  private copyContentEditor(source: ContentEditorState): ContentEditorState {
    let editor: ContentEditorState = {
      active: source.active,
      action: source.action,
      moduleId: source.moduleId,
      recordId: source.recordId,
      revision: source.revision,
      title: source.title,
      fields: source.fields,
      values: this.copyEditorValues(source.values),
      isSaving: source.isSaving,
      error: source.error
    }
    return editor
  }

  private updateEditorValue(key: string, value: string): void {
    let editor = this.copyContentEditor(this.contentEditor)
    editor.values[key] = value
    editor.error = ''
    this.contentEditor = editor
  }

  private choiceSelectOptions(field: ContentField): SelectOption[] {
    let options: SelectOption[] = []
    field.options.forEach((option: ContentChoice) => {
      let selectOption: SelectOption = { value: option.label }
      options.push(selectOption)
    })
    return options
  }

  private choiceIndex(field: ContentField): number {
    let values = this.editorChoiceValues[field.key] || []
    let index = values.indexOf(this.editorValue(field.key))
    return index >= 0 ? index : 0
  }

  private confirmContentDelete(record: ContentRecord): void {
    AlertDialog.show({
      title: '确认删除',
      message: `确认删除 ${record.title}？此操作无法撤销。`,
      primaryButton: { value: '删除', fontColor: '#9A3F37', action: () => this.submitContentAction('delete', record.id, record.revision, {}, record.id) },
      secondaryButton: { value: '取消', action: () => {} }
    })
  }

  private async submitContentAction(action: string, recordId: string, revision: string,
    values: Record<string, string>, confirmation: string): Promise<void> {
    let moduleId = this.contentEditor.active ? this.contentEditor.moduleId : this.contentWorkspace.module
    let generation = this.contentWorkspaceGeneration
    if (!this.isContentModule(moduleId) || !this.isContentAction(action) || this.contentEditor.isSaving) return
    if (action === 'create' && moduleId !== 'websites') return
    this.contentEditor.isSaving = true
    this.contentEditor.error = ''
    this.contentEditor = this.copyContentEditor(this.contentEditor)
    let payload: Record<string, Object> = {
      'moduleId': moduleId,
      'action': action,
      'recordId': recordId,
      'revision': revision,
      'values': values,
      'confirmation': confirmation
    }
    let result = await this.contentRequest(moduleId, 'submit', payload)
    if (result.statusCode === 401) {
      await this.handleContentResult(result)
      return
    }
    if (!this.isCurrentContentWorkspace(moduleId, generation)) return
    if (!await this.handleContentResult(result)) {
      if (this.contentEditor.active) {
        this.contentEditor.isSaving = false
        this.contentEditor.error = result.error || this.statusText
        this.contentEditor = this.copyContentEditor(this.contentEditor)
      }
      return
    }
    this.contentEditor.isSaving = false
    this.contentEditor = this.emptyContentEditor()
    this.editorChoiceValues = {}
    this.statusText = action === 'delete' ? '删除成功，正在刷新' : '保存成功，正在刷新'
    let module = this.nativeModules.find((item: NativeModule) => item.id === moduleId)
    if (module) await this.showContentWorkspace(module)
  }

  @Builder
  private LoginView() {
    Column({ space: 18 }) {
      Column({ space: 5 }) {
        Text('铮铮控制台').fontSize(28).fontWeight(FontWeight.Bold).fontColor('#18231E')
        Text('HarmonyOS').fontSize(13).fontColor('#637068')
      }.alignItems(HorizontalAlign.Start).width('100%')

      Row() {
        Button('管理员').layoutWeight(1).height(36).fontSize(14)
          .fontColor(this.loginMode === 0 ? '#FFFFFF' : '#4E5E55')
          .backgroundColor(this.loginMode === 0 ? '#216B4E' : '#E8EEEA')
          .borderRadius(7).onClick(() => this.loginMode = 0)
        Button('通行证').layoutWeight(1).height(36).fontSize(14)
          .fontColor(this.loginMode === 1 ? '#FFFFFF' : '#4E5E55')
          .backgroundColor(this.loginMode === 1 ? '#216B4E' : '#E8EEEA')
          .borderRadius(7).onClick(() => this.loginMode = 1)
      }.width('100%').padding(3).backgroundColor('#E8EEEA').borderRadius(9)

      TextInput({ placeholder: this.loginMode === 0 ? '管理员账号' : '通行证账号', text: this.username })
        .height(48).backgroundColor('#FFFFFF').border({ width: 1, color: '#D8E0DB' }).borderRadius(8)
        .onChange((value: string) => this.username = value)
      TextInput({ placeholder: '密码', text: this.password })
        .type(InputType.Password).height(48).backgroundColor('#FFFFFF')
        .border({ width: 1, color: '#D8E0DB' }).borderRadius(8)
        .onChange((value: string) => this.password = value)
      Button(this.isBusy ? '正在验证' : '登录')
        .width('100%').height(48).fontSize(16).fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF').backgroundColor('#216B4E').borderRadius(8)
        .enabled(!this.isBusy).onClick(() => this.login())
      Text(this.statusText).fontSize(13).fontColor(this.token.length > 0 ? '#216B4E' : '#A44A3F').width('100%')
    }
    .width('100%').constraintSize({ maxWidth: 460 }).padding(24).backgroundColor('#F7F9F8').borderRadius(10)
  }

  @Builder
  private Metric(title: string, value: string) {
    Column({ space: 7 }) {
      Text(title).fontSize(12).fontColor('#68756D').width('100%')
      Text(value).fontSize(24).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%')
    }
    .padding(14).height(82).backgroundColor('#FFFFFF').border({ width: 1, color: '#DCE3DF' }).borderRadius(8)
  }

  @Builder
  private OverviewView() {
    Column({ space: 14 }) {
      Grid() {
        GridItem() { this.Metric('在线', `${this.onlineCount}`) }
        GridItem() { this.Metric('通行证用户', `${this.userCount}`) }
        GridItem() { this.Metric('内存', `${this.memoryMB} MB`) }
        GridItem() { this.Metric('运行', `${this.uptimeHours} h`) }
      }.columnsTemplate('1fr 1fr').columnsGap(10).rowsGap(10).width('100%')
      Column({ space: 7 }) {
        Text('客户端').fontSize(13).fontColor('#68756D').width('100%')
        Text(this.updateText).fontSize(16).fontWeight(FontWeight.Medium).fontColor('#1B2921').width('100%')
        if (this.updateAvailable) {
          Button('下载并安装更新').height(40).fontColor('#FFFFFF').backgroundColor('#216B4E').borderRadius(7)
            .enabled(!this.isBusy).onClick(() => this.downloadManagerUpdate())
        }
      }.padding(15).width('100%').backgroundColor('#FFFFFF').border({ width: 1, color: '#DCE3DF' }).borderRadius(8)
      Row({ space: 8 }) {
        Button('事务').layoutWeight(1).height(40).fontColor('#34423A').backgroundColor('#E8EEEA').borderRadius(7)
          .onClick(() => this.selectedTab = 1)
        Button('工作台').layoutWeight(1).height(40).fontColor('#FFFFFF').backgroundColor('#216B4E').borderRadius(7)
          .onClick(() => { this.toolMode = 0; this.selectedTab = 2 })
      }.width('100%')
    }.width('100%')
  }

  @Builder
  private WorkspaceRow(title: string, detail: string) {
    Column({ space: 3 }) {
      Text(title).fontSize(14).fontWeight(FontWeight.Medium).fontColor('#1B2921').width('100%')
      Text(detail).fontSize(12).fontColor('#68756D').width('100%').maxLines(3)
    }.padding({ top: 9, bottom: 9 }).width('100%').border({ width: { bottom: 1 }, color: '#E6EBE8' })
  }

  @Builder
  private OperationsView() {
    Column({ space: 14 }) {
      Row({ space: 8 }) {
        if (this.hasPermission('termux_terminal')) {
          Button('终端').layoutWeight(1).height(40).fontColor('#FFFFFF').backgroundColor('#18231E').borderRadius(7)
            .onClick(() => this.toolMode = 1)
        }
        Button('刷新').layoutWeight(1).height(40).fontColor('#216B4E').backgroundColor('#E4F0E9').borderRadius(7)
          .onClick(() => this.loadWorkspace())
      }.width('100%')

      if (this.workspaceError.length > 0) {
        Text(this.workspaceError).fontSize(13).fontColor('#A44A3F').padding(14).width('100%').backgroundColor('#F8F1F0').borderRadius(8)
      }
      Column() {
        Text(`全部功能 · ${this.nativeModules.length}`).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%').padding({ bottom: 8 })
        if (this.nativeModules.length === 0) {
          Text('当前账号没有可用管理模块').fontSize(13).fontColor('#68756D').padding({ top: 8, bottom: 8 }).width('100%')
        }
        ForEach(this.nativeModules, (item: NativeModule) => {
          Button(`${item.label}  ·  ${item.group}`)
            .height(42).fontSize(14).fontColor('#26352D').backgroundColor('#F3F6F4').borderRadius(7)
            .onClick(() => this.openNativeModule(item))
        }, (item: NativeModule) => item.id)
      }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(8)
      if (this.hasPermission('system_check')) {
        Column() {
          Text('系统状态').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%').padding({ bottom: 6 })
          this.WorkspaceRow('在线与用户', `在线 ${this.onlineCount} · 通行证 ${this.userCount}`)
          this.WorkspaceRow('资源', `内存 ${this.memoryMB} MB · 运行 ${this.uptimeHours} h`)
        }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(8)
      }
      if (this.hasPermission('admin_manage')) {
        Column() {
          Text(`管理员 · ${this.workspaceAdmins.length}`).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%').padding({ bottom: 6 })
          if (this.workspaceAdmins.length === 0) {
            Text('暂无其他管理员').fontSize(13).fontColor('#68756D').padding({ top: 8, bottom: 8 }).width('100%')
          }
          ForEach(this.workspaceAdmins, (item: WorkspaceAdmin) => {
            Column({ space: 6 }) {
              this.WorkspaceRow(item.username, `${this.roleLabel(item.role)} · ${item.status === 'active' ? '启用' : '停用'} · ${item.permissionCount < 0 ? '全部权限' : `${item.permissionCount} 项权限`}`)
              if (item.manageable) {
                Button(item.status === 'active' ? '停用管理员' : '启用管理员')
                  .height(34).fontSize(12).fontColor(item.status === 'active' ? '#9A3F37' : '#216B4E')
                  .backgroundColor(item.status === 'active' ? '#F4E7E5' : '#E4F0E9').borderRadius(6)
                  .onClick(() => this.updateAdminStatus(item))
              }
            }.width('100%')
          }, (item: WorkspaceAdmin) => item.username)
        }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(8)
      }
      if (this.hasPermission('logs_view')) {
        Column() {
          Text('最近审计').fontSize(16).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%').padding({ bottom: 6 })
          if (this.workspaceAudit.length === 0) {
            Text('暂无审计记录').fontSize(13).fontColor('#68756D').padding({ top: 8, bottom: 8 }).width('100%')
          }
          ForEach(this.workspaceAudit, (item: WorkspaceAudit, index: number) => {
            this.WorkspaceRow(item.action || '管理员操作', `${item.username || 'unknown'} · ${item.result || 'success'}\n${item.timestamp || ''}`)
          }, (item: WorkspaceAudit, index: number) => `${item.timestamp}-${index}`)
        }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(8)
      }
      Column() {
        Text(`客户端 · ${this.workspaceApps.length}`).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%').padding({ bottom: 6 })
        if (this.workspaceApps.length === 0) {
          Text('暂无已发布客户端').fontSize(13).fontColor('#68756D').padding({ top: 8, bottom: 8 }).width('100%')
        }
        ForEach(this.workspaceApps, (item: WorkspaceApp) => {
          this.WorkspaceRow(item.platformLabel || item.platform, `v${item.version} · build ${item.build} · ${item.available ? '可下载' : '文件缺失'}`)
        }, (item: WorkspaceApp) => item.id)
      }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(8)
    }.width('100%')
  }

  @Builder
  private NativeModuleView() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Button('返回工作台').height(38).fontColor('#216B4E').backgroundColor('#E4F0E9').borderRadius(7)
          .onClick(() => { this.closeContentEditor(); this.toolMode = 0 })
        Text(this.selectedModuleTitle).fontSize(18).fontWeight(FontWeight.Bold).fontColor('#1B2921').layoutWeight(1)
      }.width('100%')
      if (this.isContentModule(this.contentWorkspaceModuleId)) {
        if (this.contentWorkspace.module === this.contentWorkspaceModuleId) {
          if (this.contentEditor.active) {
            this.ContentEditorView()
          } else {
            this.ContentWorkspaceView()
          }
        } else if (this.nativeModuleError.length > 0) {
          Text(this.nativeModuleError)
            .fontSize(14).fontColor('#A44A3F').padding(14).width('100%').backgroundColor('#F8F1F0').borderRadius(8)
        } else {
          Column({ space: 8 }) {
            LoadingProgress().width(28).height(28).color('#216B4E')
            Text('正在读取内容...').fontSize(13).fontColor('#68756D')
          }.padding(24).width('100%')
        }
      } else {
        Text(this.nativeModuleError || '当前模块不可用')
          .fontSize(14).fontColor('#A44A3F').padding(14).width('100%').backgroundColor('#F8F1F0').borderRadius(8)
      }
    }.width('100%')
  }

  @Builder
  private ContentWorkspaceView() {
    Column({ space: 10 }) {
      if (this.nativeModuleError.length > 0) {
        Text(this.nativeModuleError).fontSize(13).fontColor('#A44A3F').padding(12).width('100%').backgroundColor('#F8F1F0').borderRadius(7)
      }
      Row({ space: 8 }) {
        Text(`${this.contentWorkspace.records.length} 条记录`).fontSize(13).fontColor('#68756D').layoutWeight(1)
        if (this.contentWorkspace.canCreate) {
          Button('新建').height(36).fontSize(13).fontColor('#FFFFFF').backgroundColor('#216B4E').borderRadius(6)
            .enabled(!this.isBusy).onClick(() => this.openContentEditor('create'))
        }
        Button('刷新').height(36).fontSize(13).fontColor('#216B4E').backgroundColor('#E4F0E9').borderRadius(6)
          .enabled(!this.isBusy).onClick(() => {
            let module = this.nativeModules.find((item: NativeModule) => item.id === this.contentWorkspace.module)
            if (module) this.showContentWorkspace(module)
          })
      }.width('100%')
      if (this.contentWorkspace.records.length === 0 && this.nativeModuleError.length === 0) {
        Text('暂无记录').fontSize(14).fontColor('#68756D').padding(24).width('100%').textAlign(TextAlign.Center)
      }
      ForEach(this.contentWorkspace.records, (record: ContentRecord) => {
        this.ContentRecordView(record)
      }, (record: ContentRecord) => record.id)
    }.width('100%')
  }

  @Builder
  private ContentRecordView(record: ContentRecord) {
    Column({ space: 8 }) {
      Column({ space: 3 }) {
        Text(record.title || record.id).fontSize(16).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%')
        if (record.subtitle.length > 0) {
          Text(record.subtitle).fontSize(12).fontColor('#68756D').width('100%').maxLines(2)
        }
      }.width('100%')
      ForEach(record.fields, (field: ContentField) => {
        Text(`${field.label}: ${field.value || '未填写'}`).fontSize(12).fontColor('#4D5B53').width('100%').maxLines(2)
      }, (field: ContentField) => field.key)
      Row({ space: 8 }) {
        if (record.actions.includes('update')) {
          Button('编辑').layoutWeight(1).height(34).fontSize(12).fontColor('#216B4E').backgroundColor('#E4F0E9').borderRadius(6)
            .onClick(() => this.openContentEditor('update', record))
        }
        if (record.actions.includes('delete')) {
          Button('删除').layoutWeight(1).height(34).fontSize(12).fontColor('#9A3F37').backgroundColor('#F4E7E5').borderRadius(6)
            .onClick(() => this.confirmContentDelete(record))
        }
      }.width('100%')
    }.padding(14).width('100%').backgroundColor('#FFFFFF').border({ width: 1, color: '#DCE3DF' }).borderRadius(8)
  }

  @Builder
  private ContentEditorView() {
    Column({ space: 12 }) {
      Text(this.contentEditor.title).fontSize(17).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%')
      if (this.contentEditor.error.length > 0) {
        Text(this.contentEditor.error).fontSize(13).fontColor('#A44A3F').padding(12).width('100%').backgroundColor('#F8F1F0').borderRadius(7)
      }
      ForEach(this.contentEditor.fields, (field: ContentField) => {
        Column({ space: 5 }) {
          Text(`${field.label}${field.required ? ' *' : ''}`).fontSize(13).fontColor('#34423A').width('100%')
          if (!field.editable) {
            Text(field.value || '未填写').fontSize(13).fontColor('#68756D').padding(11).width('100%').backgroundColor('#EEF2F0').borderRadius(6)
          } else if (field.type === 'multiline') {
            TextArea({ placeholder: field.label, text: this.editorValue(field.key) })
              .height(116).maxLength(field.maxLength > 0 ? field.maxLength : 20000).backgroundColor('#FFFFFF')
              .border({ width: 1, color: '#D8E0DB' }).borderRadius(7)
              .onChange((value: string) => this.updateEditorValue(field.key, value))
          } else if (field.type === 'choice') {
            Select(this.choiceSelectOptions(field))
              .selected(this.choiceIndex(field)).width('100%').height(42).backgroundColor('#FFFFFF')
              .onSelect((index: number, _: string) => {
                let values = this.editorChoiceValues[field.key] || []
                if (index >= 0 && index < values.length) {
                  this.updateEditorValue(field.key, values[index])
                }
              })
          } else {
            TextInput({ placeholder: field.label, text: this.editorValue(field.key) })
              .height(44).maxLength(field.maxLength > 0 ? field.maxLength : 2048).backgroundColor('#FFFFFF')
              .border({ width: 1, color: '#D8E0DB' }).borderRadius(7)
              .onChange((value: string) => this.updateEditorValue(field.key, value))
          }
        }.width('100%')
      }, (field: ContentField) => field.key)
      Row({ space: 8 }) {
        Button('取消').layoutWeight(1).height(42).fontColor('#34423A').backgroundColor('#E8EEEA').borderRadius(7)
          .enabled(!this.contentEditor.isSaving).onClick(() => this.closeContentEditor())
        Button(this.contentEditor.isSaving ? '保存中' : '保存').layoutWeight(1).height(42).fontColor('#FFFFFF').backgroundColor('#216B4E').borderRadius(7)
          .enabled(!this.contentEditor.isSaving).onClick(() => {
            this.submitContentAction(this.contentEditor.action, this.contentEditor.recordId, this.contentEditor.revision,
              this.contentEditor.values, '')
          })
      }.width('100%')
    }.padding(14).width('100%').backgroundColor('#FFFFFF').border({ width: 1, color: '#DCE3DF' }).borderRadius(8)
  }

  private roleLabel(role: string): string {
    if (role === 'super') return '总管理员'
    if (role === 'admin') return '管理员'
    if (role === 'operator') return '运维'
    if (role === 'editor') return '编辑'
    return role
  }

  @Builder
  private FeedbackView() {
    Column({ space: 10 }) {
      Text(this.feedbackSummary).fontSize(13).fontColor('#68756D').width('100%')
      if (this.feedbackItems.length === 0) {
        Text('当前没有待处理反馈').fontSize(15).fontColor('#68756D').padding(24).width('100%').textAlign(TextAlign.Center)
      }
      ForEach(this.feedbackItems, (item: FeedbackItem) => {
        Column({ space: 7 }) {
          Row() {
            Text(item.category || item.product || '用户反馈').fontSize(14).fontWeight(FontWeight.Bold).layoutWeight(1)
            Text(item.status).fontSize(12).fontColor('#216B4E')
          }.width('100%')
          Text(item.message).fontSize(14).fontColor('#34423A').maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(`${item.product || '-'} · ${item.platform || '-'} · ${item.account || '匿名'}`)
            .fontSize(12).fontColor('#68756D').width('100%')
          Row({ space: 8 }) {
            Button('复制记录').height(32).fontSize(12).backgroundColor('#EDF1EF').fontColor('#34423A').borderRadius(6)
              .onClick(() => this.copyFeedbackRecord(item))
            if (this.hasPermission('feedback_manage')) {
              Button('处理中').height(32).fontSize(12).backgroundColor('#EDF1EF').fontColor('#34423A').borderRadius(6)
                .onClick(() => this.updateFeedback(item, 'reviewing'))
              Button('解决').height(32).fontSize(12).backgroundColor('#216B4E').fontColor('#FFFFFF').borderRadius(6)
                .onClick(() => this.updateFeedback(item, 'resolved'))
            }
          }.width('100%')
        }.padding(14).width('100%').backgroundColor('#FFFFFF').border({ width: 1, color: '#DCE3DF' }).borderRadius(8)
      }, (item: FeedbackItem) => item.id)
    }.width('100%')
  }

  @Builder
  private TerminalView() {
    Column({ space: 12 }) {
      Text(this.terminalStatus).fontSize(13).fontColor('#68756D').width('100%')
      TextInput({ placeholder: '输入命令', text: this.command })
        .height(46).fontFamily('monospace').backgroundColor('#FFFFFF')
        .border({ width: 1, color: '#CBD5CF' }).borderRadius(8)
        .onChange((value: string) => this.command = value)
      Row({ space: 8 }) {
        Button(this.isBusy ? '执行中' : '执行').layoutWeight(1).height(42)
          .backgroundColor('#18231E').fontColor('#FFFFFF').borderRadius(7)
          .enabled(!this.isBusy).onClick(() => this.runCommand())
        Button('复制输出').layoutWeight(1).height(42).backgroundColor('#E8EEEA').fontColor('#34423A').borderRadius(7)
          .onClick(() => this.copyTerminalOutput())
        Button('清空').layoutWeight(1).height(42).backgroundColor('#E8EEEA').fontColor('#34423A').borderRadius(7)
          .onClick(() => this.clearTerminalOutput())
      }.width('100%')
      Text('标准输出').fontSize(12).fontColor('#68756D').width('100%')
      Scroll() {
        Text(this.terminalStandardOutput || '命令成功输出会显示在这里')
          .width('100%').padding(12).fontSize(13).fontFamily('monospace')
          .fontColor('#DDE7E1').copyOption(CopyOptions.LocalDevice)
      }.width('100%').height(160).backgroundColor('#18231E').borderRadius(8).scrollBar(BarState.Auto)
      Text('错误输出').fontSize(12).fontColor('#68756D').width('100%')
      Scroll() {
        Text(this.terminalErrorOutput || '暂无错误输出')
          .width('100%').padding(12).fontSize(13).fontFamily('monospace')
          .fontColor('#C8584D').copyOption(CopyOptions.LocalDevice)
      }.width('100%').height(100).backgroundColor('#F8F1F0').borderRadius(8).scrollBar(BarState.Auto)
    }.width('100%')
  }

  @Builder
  private AccountView() {
    Column({ space: 14 }) {
      Column({ space: 5 }) {
        Text(this.username).fontSize(20).fontWeight(FontWeight.Bold).fontColor('#1B2921').width('100%')
        Text(this.statusText).fontSize(13).fontColor('#68756D').width('100%')
      }.padding(16).width('100%').backgroundColor('#FFFFFF').border({ width: 1, color: '#DCE3DF' }).borderRadius(8)
      Button('退出登录').width('100%').height(42).backgroundColor('#F4E7E5').fontColor('#9A3F37').borderRadius(7)
        .onClick(() => this.clearSession())
    }.width('100%')
  }

  @Builder
  private BottomNav() {
    Row() {
      Button('总览').layoutWeight(1).height(50).fontSize(13)
        .fontColor(this.selectedTab === 0 ? '#216B4E' : '#66736B').backgroundColor(Color.Transparent)
        .onClick(() => this.selectedTab = 0)
      Button('事务').layoutWeight(1).height(50).fontSize(13)
        .fontColor(this.selectedTab === 1 ? '#216B4E' : '#66736B').backgroundColor(Color.Transparent)
        .onClick(() => this.selectedTab = 1)
      Button('工作台').layoutWeight(1).height(50).fontSize(13)
        .fontColor(this.selectedTab === 2 ? '#216B4E' : '#66736B').backgroundColor(Color.Transparent)
        .onClick(() => { this.toolMode = 0; this.selectedTab = 2 })
      Button('账户').layoutWeight(1).height(50).fontSize(13)
        .fontColor(this.selectedTab === 3 ? '#216B4E' : '#66736B').backgroundColor(Color.Transparent)
        .onClick(() => this.selectedTab = 3)
    }.width('100%').padding({ left: 6, right: 6 }).backgroundColor('#FFFFFF').border({ width: { top: 1 }, color: '#DCE3DF' })
  }

  build() {
    if (this.token.length === 0) {
      Column() { this.LoginView() }
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .padding(20).width('100%').height('100%').backgroundColor('#EEF2F0')
    } else {
      Column() {
        Row() {
          Column({ space: 3 }) {
            Text(this.selectedTab === 0 ? '总览' : this.selectedTab === 1 ? '事务' : this.selectedTab === 2 ? (this.toolMode === 1 ? '终端' : this.toolMode === 2 ? this.selectedModuleTitle : '工作台') : '账户')
              .fontSize(23).fontWeight(FontWeight.Bold).fontColor('#18231E')
            Text(this.statusText).fontSize(12).fontColor('#68756D')
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          if (this.isBusy) { LoadingProgress().width(24).height(24).color('#216B4E') }
        }.width('100%').padding({ left: 18, right: 18, top: 16, bottom: 12 }).backgroundColor('#F4F7F5')
        Scroll() {
          Column() {
            if (this.selectedTab === 0) this.OverviewView()
            if (this.selectedTab === 1 && this.hasPermission('feedback_view')) this.FeedbackView()
            if (this.selectedTab === 1 && !this.hasPermission('feedback_view')) {
              Text('当前账号没有反馈查看权限').fontSize(14).fontColor('#68756D').padding(24).width('100%').textAlign(TextAlign.Center)
            }
            if (this.selectedTab === 2 && this.toolMode === 0) this.OperationsView()
            if (this.selectedTab === 2 && this.toolMode === 1 && this.hasPermission('termux_terminal')) {
              Column({ space: 10 }) {
                Button('返回工作台').height(38).fontColor('#216B4E').backgroundColor('#E4F0E9').borderRadius(7)
                  .onClick(() => this.toolMode = 0)
                this.TerminalView()
              }.width('100%')
            }
            if (this.selectedTab === 2 && this.toolMode === 2) this.NativeModuleView()
            if (this.selectedTab === 3) this.AccountView()
          }.padding({ left: 14, right: 14, top: 8, bottom: 18 }).width('100%')
        }.layoutWeight(1).width('100%').backgroundColor('#F4F7F5')
        this.BottomNav()
      }.width('100%').height('100%').backgroundColor('#F4F7F5')
    }
  }
}
