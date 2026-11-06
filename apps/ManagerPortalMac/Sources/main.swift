import Cocoa
import Foundation
import ObjectiveC
import UserNotifications

let appVersion = "1.5.2"
let appBuild = 14
let updateId = "manager-portal-macos"
let siteRoot = "https://zhengzhengstudio.cn"
let notificationFeedURL = "https://zhengzhengstudio.cn/api/manager/notifications?limit=20"

struct AdminSession {
    let username: String
    let role: String
    let permissions: [String]

    var isSuper: Bool { role == "super" || permissions.contains("*") }
    func can(_ permission: String) -> Bool { isSuper || permissions.contains(permission) }
}

struct Notice {
    let id: String
    let title: String
    let body: String
    let level: String
    let createdAt: String
}

struct AppUpdate {
    let fileName: String
    let version: String
    let build: Int
    let size: Int
}

private struct ContentHTTPResult {
    let statusCode: Int
    let json: [String: Any]?
    let requestToken: String?
    let requestUsername: String?
}

private var controlActionOwnerKey: UInt8 = 0

private final class ControlActionOwner: NSObject {
    private let handler: () -> Void

    init(handler: @escaping () -> Void) {
        self.handler = handler
    }

    @objc func invoke(_ sender: NSControl) {
        handler()
    }
}

private func bindControlAction(_ control: NSControl, handler: @escaping () -> Void) {
    let owner = ControlActionOwner(handler: handler)
    control.target = owner
    control.action = #selector(ControlActionOwner.invoke(_:))
    objc_setAssociatedObject(control, &controlActionOwnerKey, owner, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var sidebar: NSStackView!
    private var content: NSStackView!
    private var statusLabel = NSTextField(labelWithString: "未登录")
    private var usernameField = NSTextField()
    private var passwordField = NSSecureTextField()
    private var terminalCommandField = NSTextField(string: "pm2 status")
    private var terminalStandardOutput = NSTextView()
    private var terminalErrorOutput = NSTextView()
    private var session: AdminSession?
    private var lastNoticeId = UserDefaults.standard.string(forKey: "managerLastNoticeId") ?? ""
    private var noticeTimer: Timer?
    private var updateTimer: Timer?
    private var selectedSection = "overview"
    private var contentWorkspaces: [String: [String: Any]] = [:]
    private var contentGeneration = 0
    private var currentContentModule: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        requestNotificationPermission()
        buildWindow()
        restoreSession()
        pollNotices()
        noticeTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.pollNotices()
        }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 1800, repeats: true) { [weak self] _ in
            self?.checkUpdates(manual: false)
        }
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "铮铮控制台"
        window.minSize = NSSize(width: 920, height: 620)
        window.center()

        let root = NSStackView()
        root.orientation = .horizontal
        root.spacing = 0
        root.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(root)

        sidebar = NSStackView()
        sidebar.orientation = .vertical
        sidebar.spacing = 8
        sidebar.edgeInsets = NSEdgeInsets(top: 22, left: 14, bottom: 18, right: 14)
        sidebar.wantsLayer = true
        sidebar.layer?.backgroundColor = NSColor(red: 0.11, green: 0.13, blue: 0.15, alpha: 1).cgColor
        root.addArrangedSubview(sidebar)

        let mainScroll = NSScrollView()
        mainScroll.hasVerticalScroller = true
        mainScroll.drawsBackground = false
        let clip = NSStackView()
        clip.orientation = .vertical
        clip.spacing = 22
        clip.edgeInsets = NSEdgeInsets(top: 28, left: 30, bottom: 28, right: 30)
        clip.translatesAutoresizingMaskIntoConstraints = false
        mainScroll.documentView = clip
        content = clip
        root.addArrangedSubview(mainScroll)

        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            root.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            root.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: 218),
            clip.widthAnchor.constraint(equalTo: mainScroll.contentView.widthAnchor),
            clip.widthAnchor.constraint(greaterThanOrEqualToConstant: 650)
        ])
        window.makeKeyAndOrderFront(nil)
    }

    private func rebuildSidebar() {
        sidebar.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let brand = NSStackView()
        brand.orientation = .horizontal
        brand.alignment = .centerY
        brand.spacing = 10
        let icon = NSImageView()
        icon.image = NSImage(named: NSImage.applicationIconName)
        icon.imageScaling = .scaleProportionallyUpOrDown
        brand.addArrangedSubview(icon)
        icon.widthAnchor.constraint(equalToConstant: 32).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 32).isActive = true
        brand.addArrangedSubview(label("铮铮控制台", 17, .semibold, .white))
        sidebar.addArrangedSubview(brand)
        sidebar.addArrangedSubview(gap(12))
        sidebar.addArrangedSubview(sidebarLabel("概览"))
        sidebar.addArrangedSubview(navButton("总览", symbol: "rectangle.grid.2x2", section: "overview") { [weak self] in self?.showDashboard() })
        sidebar.addArrangedSubview(navButton("通知", symbol: "bell", section: "notices") { [weak self] in self?.showNotices() })
        sidebar.addArrangedSubview(navButton("工作台", symbol: "square.grid.2x2", section: "operations") { [weak self] in self?.showOperations() })
        if session?.can("feedback_view") == true {
            sidebar.addArrangedSubview(navButton("反馈", symbol: "text.bubble", section: "feedback") { [weak self] in self?.showFeedback() })
        }
        sidebar.addArrangedSubview(sidebarLabel("工具"))
        if session?.can("user_insights") == true {
            sidebar.addArrangedSubview(navButton("用户喜好", symbol: "chart.bar.xaxis", section: "insights") { [weak self] in self?.showInsights() })
        }
        sidebar.addArrangedSubview(navButton("权限", symbol: "key.horizontal", section: "permissions") { [weak self] in self?.showPermissions() })
        sidebar.addArrangedSubview(navButton("更新", symbol: "arrow.down.circle", section: "updates") { [weak self] in
            self?.selectedSection = "updates"
            self?.rebuildSidebar()
            self?.checkUpdates(manual: true)
        })
        if session?.can("termux_terminal") == true {
            sidebar.addArrangedSubview(navButton("终端", symbol: "terminal", section: "terminal") { [weak self] in self?.showTerminalStatus() })
        }
        sidebar.addArrangedSubview(spacer())
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.textColor = NSColor(red: 0.62, green: 0.66, blue: 0.68, alpha: 1)
        sidebar.addArrangedSubview(statusLabel)
        sidebar.addArrangedSubview(navButton(session == nil ? "登录" : "退出", symbol: session == nil ? "person.crop.circle" : "rectangle.portrait.and.arrow.right", section: "account") { [weak self] in
            self?.logout()
        })
    }

    private func restoreSession() {
        rebuildSidebar()
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername"),
              !token.isEmpty, !username.isEmpty else {
            showLogin()
            return
        }
        fetchSession(username: username, token: token) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let session):
                    self?.session = session
                    self?.statusLabel.stringValue = "已授权"
                    self?.rebuildSidebar()
                    self?.showDashboard()
                    self?.checkUpdates(manual: false)
                case .failure:
                    self?.showLogin()
                }
            }
        }
    }

    private func showLogin() {
        session = nil
        invalidateContentWorkspaceState()
        selectedSection = "account"
        rebuildSidebar()
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }
        content.addArrangedSubview(titleBlock("铮铮控制台", subtitle: "管理员验证"))
        let card = panel()
        let stack = cardStack(card)
        usernameField = NSTextField()
        usernameField.placeholderString = "账号"
        passwordField = NSSecureTextField()
        passwordField.placeholderString = "密码"
        stack.addArrangedSubview(formLabel("管理员账号"))
        stack.addArrangedSubview(usernameField)
        stack.addArrangedSubview(formLabel("管理员密码"))
        stack.addArrangedSubview(passwordField)
        stack.addArrangedSubview(primaryButton("管理员登录") { [weak self] in self?.login() })
        stack.addArrangedSubview(secondaryButton("通行证登录") { [weak self] in self?.passportLogin() })
        content.addArrangedSubview(card)
        statusLabel.stringValue = "未登录"
    }

    private func login() {
        let username = usernameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = passwordField.stringValue
        guard !username.isEmpty, !password.isEmpty else {
            statusLabel.stringValue = "请输入账号和密码"
            return
        }
        statusLabel.stringValue = "正在验证..."
        postJSON(path: "/api/admin/verify-password", body: ["username": username, "password": password, "managerCompat": true], token: nil, username: nil) { [weak self] json in
            DispatchQueue.main.async {
                guard let json,
                      (json["success"] as? Bool) == true,
                      let token = json["token"] as? String else {
                    self?.statusLabel.stringValue = "验证失败"
                    return
                }
                self?.acceptAdminSession(username: username, token: token, role: json["role"] as? String ?? "admin", permissions: json["permissions"] as? [String] ?? [])
            }
        }
    }

    private func passportLogin() {
        let account = usernameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = passwordField.stringValue
        guard !account.isEmpty, !password.isEmpty else {
            statusLabel.stringValue = "请输入通行证账号和密码"
            return
        }
        statusLabel.stringValue = "正在验证通行证..."
        postJSON(path: "/api/auth/login", body: ["username": account, "password": password, "managerCompat": true], token: nil, username: nil) { [weak self] json in
            guard let user = json?["user"] as? [String: Any],
                  let uid = user["uid"] ?? user["id"] else {
                DispatchQueue.main.async { self?.statusLabel.stringValue = json?["error"] as? String ?? "通行证验证失败" }
                return
            }
            let authToken = user["authToken"] as? String ?? ""
            self?.postJSON(path: "/api/admin/passport-login", body: ["passportUid": "\(uid)", "authToken": authToken, "managerCompat": true], token: nil, username: nil) { adminJson in
                DispatchQueue.main.async {
                    guard let adminJson,
                          (adminJson["success"] as? Bool) == true,
                          let token = adminJson["token"] as? String else {
                        self?.statusLabel.stringValue = adminJson?["error"] as? String ?? "通行证账号无管理员权限"
                        return
                    }
                    self?.acceptAdminSession(
                        username: adminJson["username"] as? String ?? account,
                        token: token,
                        role: adminJson["role"] as? String ?? "admin",
                        permissions: adminJson["permissions"] as? [String] ?? []
                    )
                }
            }
        }
    }

    private func acceptAdminSession(username: String, token: String, role: String, permissions: [String]) {
        invalidateContentWorkspaceState()
        UserDefaults.standard.set(token, forKey: "managerToken")
        UserDefaults.standard.set(username, forKey: "managerUsername")
        session = AdminSession(username: username, role: role, permissions: permissions)
        statusLabel.stringValue = "已授权"
        rebuildSidebar()
        showDashboard()
        checkUpdates(manual: false)
    }

    private func logout() {
        UserDefaults.standard.removeObject(forKey: "managerToken")
        UserDefaults.standard.removeObject(forKey: "managerUsername")
        showLogin()
    }

    private func showDashboard() {
        selectedSection = "overview"
        rebuildSidebar()
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }
        content.addArrangedSubview(titleBlock("总览", subtitle: session == nil ? "请先登录" : session!.username))
        guard let session else { showLogin(); return }
        let grid = NSGridView(views: [
            [summaryCard("会话", "有效", "shield.checkerboard"),
             summaryCard("权限", session.isSuper ? "全部" : "\(session.permissions.count)", "key.horizontal"),
             summaryCard("当前版本", appVersion, "arrow.down.circle"),
             summaryCard("通知", "实时", "bell")]
        ])
        grid.columnSpacing = 14
        grid.rowSpacing = 14
        content.addArrangedSubview(grid)
        showNotices(inline: true)
        let actions = panel()
        let actionStack = cardStack(actions)
        actionStack.addArrangedSubview(sectionTitle("常用操作"))
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 8
        row.addArrangedSubview(primaryButton("打开工作台") { [weak self] in self?.showOperations() })
        if session.can("feedback_view") {
            row.addArrangedSubview(secondaryButton("处理反馈") { [weak self] in self?.showFeedback() })
        }
        if session.can("termux_terminal") {
            row.addArrangedSubview(secondaryButton("打开终端") { [weak self] in self?.showTerminalStatus() })
        }
        row.addArrangedSubview(spacer())
        actionStack.addArrangedSubview(row)
        content.addArrangedSubview(actions)
    }

    private func showOperations() {
        selectedSection = "operations"
        rebuildSidebar()
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }
        content.addArrangedSubview(titleBlock("工作台", subtitle: "系统、人员、审计与客户端"))

        let shortcuts = panel()
        let shortcutStack = cardStack(shortcuts)
        shortcutStack.addArrangedSubview(sectionTitle("工具"))
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 8
        if session?.can("feedback_view") == true {
            row.addArrangedSubview(secondaryButton("反馈") { [weak self] in self?.showFeedback() })
        }
        if session?.can("user_insights") == true {
            row.addArrangedSubview(secondaryButton("用户喜好") { [weak self] in self?.showInsights() })
        }
        if session?.can("termux_terminal") == true {
            row.addArrangedSubview(secondaryButton("终端") { [weak self] in self?.showTerminalStatus() })
        }
        row.addArrangedSubview(secondaryButton("权限") { [weak self] in self?.showPermissions() })
        row.addArrangedSubview(secondaryButton("检查更新") { [weak self] in self?.checkUpdates(manual: true) })
        row.addArrangedSubview(spacer())
        shortcutStack.addArrangedSubview(row)
        content.addArrangedSubview(shortcuts)

        let box = panel()
        let stack = cardStack(box)
        let loading = mutedLabel("正在读取工作台...")
        stack.addArrangedSubview(loading)
        content.addArrangedSubview(box)
        fetchWorkspaceSummary { [weak self, weak stack, weak loading] json in
            DispatchQueue.main.async {
                guard let self, let stack else { return }
                loading?.removeFromSuperview()
                guard let json, (json["success"] as? Bool) == true else {
                    stack.addArrangedSubview(self.mutedLabel(json?["error"] as? String ?? "工作台暂时无法读取"))
                    stack.addArrangedSubview(self.secondaryButton("重新加载") { [weak self] in self?.showOperations() })
                    return
                }
                self.renderWorkspaceSummary(json, into: stack)
            }
        }
    }

    private func renderWorkspaceSummary(_ json: [String: Any], into stack: NSStackView) {
        renderNativeModules(json["modules"] as? [[String: Any]] ?? [], into: stack)
        if let system = json["system"] as? [String: Any] {
            stack.addArrangedSubview(sectionTitle("系统状态"))
            stack.addArrangedSubview(workspaceRow("在线与用户", "在线 \(system["online"] ?? 0) · 通行证 \(system["unifiedUsers"] ?? 0) · 管理员 \(system["admins"] ?? 0)"))
            stack.addArrangedSubview(workspaceRow("资源", "内存 \(system["memoryMB"] ?? 0) MB · 堆 \(system["heapMB"] ?? 0) MB · 运行 \((system["uptime"] as? Int ?? 0) / 3600) h"))
        }
        if let admins = json["admins"] as? [[String: Any]] {
            stack.addArrangedSubview(sectionTitle("管理员 · \(admins.count)"))
            if admins.isEmpty { stack.addArrangedSubview(mutedLabel("暂无其他管理员")) }
            admins.prefix(10).forEach { item in
                let count = item["permissionCount"] as? Int ?? 0
                let username = item["username"] as? String ?? "未命名管理员"
                let status = item["status"] as? String ?? "active"
                let detail = "\(roleLabel(item["role"] as? String ?? "editor")) · \(status == "active" ? "启用" : "停用") · \(count < 0 ? "全部权限" : "\(count) 项权限")"
                if (item["manageable"] as? Bool) == true {
                    stack.addArrangedSubview(workspaceActionRow(username, detail, actionTitle: status == "active" ? "停用" : "启用") { [weak self] in
                        self?.updateAdminStatus(username: username, status: status == "active" ? "disabled" : "active")
                    })
                } else {
                    stack.addArrangedSubview(workspaceRow(username, detail))
                }
            }
        }
        if let audit = json["audit"] as? [[String: Any]] {
            stack.addArrangedSubview(sectionTitle("最近审计"))
            if audit.isEmpty { stack.addArrangedSubview(mutedLabel("暂无审计记录")) }
            audit.prefix(8).forEach { item in
                stack.addArrangedSubview(workspaceRow(
                    item["action"] as? String ?? "管理员操作",
                    "\(item["username"] as? String ?? "unknown") · \(item["result"] as? String ?? "success") · \(item["timestamp"] as? String ?? "")"
                ))
            }
        }
        let apps = json["apps"] as? [[String: Any]] ?? []
        stack.addArrangedSubview(sectionTitle("客户端 · \(apps.count)"))
        if apps.isEmpty { stack.addArrangedSubview(mutedLabel("暂无已发布客户端")) }
        apps.forEach { item in
            stack.addArrangedSubview(workspaceRow(
                item["platformLabel"] as? String ?? item["platform"] as? String ?? "客户端",
                "v\(item["version"] as? String ?? "-") · build \(item["build"] ?? 0) · \((item["available"] as? Bool) == true ? "可下载" : "文件缺失")"
            ))
        }
    }

    private func renderNativeModules(_ modules: [[String: Any]], into stack: NSStackView) {
        stack.addArrangedSubview(sectionTitle("全部功能 · \(modules.count)"))
        if modules.isEmpty {
            stack.addArrangedSubview(mutedLabel("当前账号没有可用管理模块"))
            return
        }
        modules.forEach { module in
            let label = module["label"] as? String ?? "管理模块"
            let group = module["group"] as? String ?? "管理"
            stack.addArrangedSubview(workspaceActionRow(label, group, actionTitle: "打开") { [weak self] in
                self?.openNativeModule(module)
            })
        }
    }

    private func openNativeModule(_ module: [String: Any]) {
        let moduleId = module["id"] as? String ?? ""
        if isContentModule(moduleId) {
            showContentWorkspace(module)
            return
        }
        switch moduleId {
        case "feedback": showFeedback()
        case "insights": showInsights()
        case "terminal": showTerminalStatus()
        case "system", "security", "admins": showOperations()
        default: showNativeModuleWorkspace(module)
        }
    }

    private func showNativeModuleWorkspace(_ module: [String: Any]) {
        let title = module["label"] as? String ?? "管理模块"
        guard let endpoint = module["endpoint"] as? String, !endpoint.isEmpty,
              let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        selectedSection = "operations"
        rebuildSidebar()
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }
        content.addArrangedSubview(titleBlock(title, subtitle: module["group"] as? String ?? "管理"))
        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 8
        actions.addArrangedSubview(secondaryButton("返回工作台") { [weak self] in self?.showOperations() })
        actions.addArrangedSubview(secondaryButton("刷新") { [weak self] in self?.showNativeModuleWorkspace(module) })
        actions.addArrangedSubview(spacer())
        content.addArrangedSubview(actions)
        let box = panel()
        let inner = cardStack(box)
        let loading = mutedLabel("正在读取数据...")
        inner.addArrangedSubview(loading)
        content.addArrangedSubview(box)
        getJSON(path: endpoint, token: token, username: username) { [weak self, weak inner, weak loading] json in
            DispatchQueue.main.async {
                guard let self, let inner else { return }
                loading?.removeFromSuperview()
                guard let json, (json["success"] as? Bool) == true else {
                    inner.addArrangedSubview(self.mutedLabel(json?["error"] as? String ?? "模块数据读取失败"))
                    return
                }
                self.renderLegacyWorkspaceJSON(json["data"] ?? [String: Any](), into: inner)
            }
        }
    }

    private func isContentModule(_ moduleId: String) -> Bool {
        ["media", "downloads", "documents", "websites", "works"].contains(moduleId)
    }

    private func beginContentWorkspace(_ moduleId: String) -> Int {
        contentGeneration += 1
        currentContentModule = moduleId
        return contentGeneration
    }

    private func isCurrentContentWorkspace(_ moduleId: String, generation: Int) -> Bool {
        currentContentModule == moduleId && contentGeneration == generation
    }

    private func invalidateContentWorkspaceState() {
        contentGeneration += 1
        currentContentModule = nil
        contentWorkspaces.removeAll()
    }

    private func showContentWorkspace(_ module: [String: Any]) {
        let moduleId = module["id"] as? String ?? ""
        guard isContentModule(moduleId),
              let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        let generation = beginContentWorkspace(moduleId)
        selectedSection = "operations"
        rebuildSidebar()
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }
        content.addArrangedSubview(titleBlock(module["label"] as? String ?? "内容管理", subtitle: module["group"] as? String ?? "管理"))
        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 8
        actions.addArrangedSubview(secondaryButton("返回工作台") { [weak self] in self?.showOperations() })
        actions.addArrangedSubview(spacer())
        content.addArrangedSubview(actions)
        let box = panel()
        let inner = cardStack(box)
        inner.addArrangedSubview(mutedLabel("正在读取记录..."))
        content.addArrangedSubview(box)
        contentRequest(path: "/api/admin/manager/content/\(contentPath(moduleId))", body: nil, token: token, username: username) { [weak self, weak inner] result in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.handleContentUnauthorized(result) { return }
                guard self.isCurrentContentWorkspace(moduleId, generation: generation), let inner else { return }
                inner.arrangedSubviews.forEach { $0.removeFromSuperview() }
                if result.statusCode == 403 {
                    inner.addArrangedSubview(self.mutedLabel(result.json?["error"] as? String ?? "当前账号没有此模块权限"))
                    return
                }
                guard result.statusCode == 200,
                      let workspace = result.json?["workspace"] as? [String: Any] else {
                    inner.addArrangedSubview(self.mutedLabel(result.json?["error"] as? String ?? "模块数据读取失败"))
                    return
                }
                self.contentWorkspaces[moduleId] = workspace
                self.renderContentWorkspace(workspace, module: module, into: inner)
            }
        }
    }

    private func renderContentWorkspace(_ workspace: [String: Any], module: [String: Any], into inner: NSStackView) {
        let moduleId = module["id"] as? String ?? ""
        if (workspace["canCreate"] as? Bool) == true {
            inner.addArrangedSubview(primaryButton("新建记录") { [weak self] in
                self?.showContentEditor(module: module, workspace: workspace, record: nil, action: "create")
            })
        }
        let records = workspace["records"] as? [[String: Any]] ?? []
        if records.isEmpty { inner.addArrangedSubview(mutedLabel("暂无记录")) }
        records.forEach { record in
            inner.addArrangedSubview(contentRecordView(record, workspace: workspace, module: module))
        }
        inner.addArrangedSubview(secondaryButton("刷新") { [weak self] in
            guard !moduleId.isEmpty else { return }
            self?.showContentWorkspace(module)
        })
    }

    private func contentRecordView(_ record: [String: Any], workspace: [String: Any], module: [String: Any]) -> NSView {
        let fields = record["fields"] as? [[String: Any]] ?? []
        let actions = record["actions"] as? [String] ?? []
        let row = NSStackView()
        row.orientation = .vertical
        row.spacing = 5
        row.edgeInsets = NSEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        row.addArrangedSubview(label(record["title"] as? String ?? "未命名记录", 15, .semibold, ink()))
        let subtitle = record["subtitle"] as? String ?? record["group"] as? String ?? ""
        if !subtitle.isEmpty { row.addArrangedSubview(mutedLabel(subtitle)) }
        fields.filter { !($0["editable"] as? Bool ?? false) }.prefix(3).forEach { field in
            let fieldTitle = field["label"] as? String ?? field["key"] as? String ?? "字段"
            row.addArrangedSubview(mutedLabel("\(fieldTitle)：\(contentText(field["value"]))"))
        }
        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 8
        if actions.contains("update") {
            buttons.addArrangedSubview(secondaryButton("编辑") { [weak self] in
                self?.showContentEditor(module: module, workspace: workspace, record: record, action: "update")
            })
        }
        if actions.contains("delete") {
            buttons.addArrangedSubview(secondaryButton("删除") { [weak self] in
                self?.confirmContentDelete(module: module, record: record)
            })
        }
        if !buttons.arrangedSubviews.isEmpty { row.addArrangedSubview(buttons) }
        return row
    }

    private func showContentEditor(module: [String: Any], workspace: [String: Any], record: [String: Any]?, action: String) {
        let fields = (record?["fields"] as? [[String: Any]]) ?? (workspace["createFields"] as? [[String: Any]]) ?? []
        let editor = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 640), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        editor.title = action == "create" ? "新建记录" : "编辑记录"
        let scroll = NSScrollView(frame: editor.contentView?.bounds ?? .zero)
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        let form = NSStackView()
        form.orientation = .vertical
        form.spacing = 10
        form.edgeInsets = NSEdgeInsets(top: 18, left: 20, bottom: 18, right: 20)
        form.frame = NSRect(x: 0, y: 0, width: 540, height: max(600, CGFloat(fields.count) * 108 + 140))
        scroll.documentView = form
        editor.contentView = scroll
        var textFields: [String: NSTextField] = [:]
        var textViews: [String: NSTextView] = [:]
        var choiceControls: [String: NSPopUpButton] = [:]
        fields.forEach { field in
            guard (field["editable"] as? Bool) == true,
                  let key = field["key"] as? String else { return }
            form.addArrangedSubview(formLabel(field["label"] as? String ?? key))
            let initial = contentText(field["value"])
            let type = field["type"] as? String ?? "text"
            if type == "multiline" {
                let input = NSTextView()
                input.string = initial
                input.font = .systemFont(ofSize: 14)
                let inputScroll = NSScrollView()
                inputScroll.hasVerticalScroller = true
                inputScroll.borderType = .bezelBorder
                inputScroll.documentView = input
                inputScroll.heightAnchor.constraint(equalToConstant: 100).isActive = true
                textViews[key] = input
                form.addArrangedSubview(inputScroll)
            } else if type == "choice" {
                let picker = NSPopUpButton()
                let options = field["options"] as? [[String: Any]] ?? []
                options.forEach { option in
                    let item = NSMenuItem(title: option["label"] as? String ?? contentText(option["value"]), action: nil, keyEquivalent: "")
                    item.representedObject = contentText(option["value"])
                    picker.menu?.addItem(item)
                    if contentText(option["value"]) == initial { picker.select(item) }
                }
                picker.isEnabled = !options.isEmpty
                choiceControls[key] = picker
                form.addArrangedSubview(picker)
            } else {
                let input = NSTextField(string: initial)
                textFields[key] = input
                form.addArrangedSubview(input)
            }
        }
        let formStatus = mutedLabel("")
        form.addArrangedSubview(formStatus)
        let saveButton = primaryButton(action == "create" ? "创建" : "保存") { }
        bindControlAction(saveButton) { [weak self, weak editor, weak saveButton, weak formStatus] in
            guard let self, let saveButton else { return }
            var values: [String: String] = [:]
            textFields.forEach { values[$0.key] = $0.value.stringValue }
            textViews.forEach { values[$0.key] = $0.value.string }
            choiceControls.forEach { values[$0.key] = ($0.value.selectedItem?.representedObject as? String) ?? "" }
            saveButton.isEnabled = false
            self.submitContentAction(
                moduleId: module["id"] as? String ?? "", action: action,
                recordId: record?["id"] as? String, revision: record?["revision"] as? String,
                values: values, confirmation: nil
            ) { [weak editor, weak saveButton, weak formStatus] success, message in
                formStatus?.stringValue = message
                if success, let editor { self.window.endSheet(editor) }
                else { saveButton?.isEnabled = true }
            }
        }
        form.addArrangedSubview(saveButton)
        window.beginSheet(editor)
    }

    private func confirmContentDelete(module: [String: Any], record: [String: Any]) {
        let recordId = record["id"] as? String ?? ""
        let title = record["title"] as? String ?? recordId
        guard !recordId.isEmpty else { return }
        let alert = NSAlert()
        alert.messageText = "删除 \(title)？"
        alert.informativeText = "此操作不可撤销。"
        alert.addButton(withTitle: "删除 \(title)")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.submitContentAction(moduleId: module["id"] as? String ?? "", action: "delete", recordId: recordId,
                                      revision: record["revision"] as? String, values: [:], confirmation: recordId) { success, message in
                self?.statusLabel.stringValue = success ? "已删除" : message
            }
        }
    }

    private func submitContentAction(moduleId: String, action: String, recordId: String?, revision: String?, values: [String: String], confirmation: String?, completion: @escaping (Bool, String) -> Void) {
        guard isContentModule(moduleId),
              let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            completion(false, "会话已失效")
            return
        }
        var body: [String: Any] = ["moduleId": moduleId, "action": action, "values": values]
        if let recordId { body["recordId"] = recordId }
        if let revision { body["revision"] = revision }
        if let confirmation { body["confirmation"] = confirmation }
        contentRequest(path: "/api/admin/manager/content/\(contentPath(moduleId))/action", body: body, token: token, username: username) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.handleContentUnauthorized(result) { completion(false, "会话已失效"); return }
                if result.statusCode == 403 { completion(false, result.json?["error"] as? String ?? "当前账号没有此操作权限"); return }
                guard (200...299).contains(result.statusCode), (result.json?["success"] as? Bool) == true else {
                    completion(false, result.json?["error"] as? String ?? "保存失败，已保留填写内容")
                    return
                }
                completion(true, "已保存")
                self.showContentWorkspace(["id": moduleId, "label": "内容管理", "group": "管理"])
            }
        }
    }

    private func contentRequest(path: String, body: [String: Any]?, token: String, username: String, completion: @escaping (ContentHTTPResult) -> Void) {
        guard let url = URL(string: siteRoot + path) else {
            completion(ContentHTTPResult(statusCode: 0, json: nil, requestToken: token, requestUsername: username))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("ManagerPortal/macOS-\(appVersion)", forHTTPHeaderField: "X-Manager-Native")
        request.setValue(token, forHTTPHeaderField: "x-admin-token")
        request.setValue(username.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? username, forHTTPHeaderField: "x-admin-username")
        if let body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            completion(ContentHTTPResult(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0, json: json, requestToken: token, requestUsername: username))
        }.resume()
    }

    private func handleContentUnauthorized(_ result: ContentHTTPResult) -> Bool {
        guard result.statusCode == 401,
              let token = result.requestToken,
              let username = result.requestUsername,
              UserDefaults.standard.string(forKey: "managerToken") == token,
              UserDefaults.standard.string(forKey: "managerUsername") == username else { return false }
        expireSessionAndShowLogin()
        return true
    }

    private func expireSessionAndShowLogin() {
        UserDefaults.standard.removeObject(forKey: "managerToken")
        UserDefaults.standard.removeObject(forKey: "managerUsername")
        session = nil
        contentWorkspaces.removeAll()
        showLogin()
    }

    private func renderLegacyWorkspaceJSON(_ value: Any, into stack: NSStackView) {
        let output = NSTextView()
        output.isEditable = false
        output.isSelectable = true
        output.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        output.textColor = ink()
        output.backgroundColor = NSColor.clear
        output.string = prettyJSON(value)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = output
        scroll.heightAnchor.constraint(equalToConstant: 460).isActive = true
        stack.addArrangedSubview(scroll)
    }

    private func contentPath(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func contentText(_ value: Any?) -> String {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    private func prettyJSON(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return String(describing: value) }
        return text
    }

    private func workspaceRow(_ title: String, _ detail: String) -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.edgeInsets = NSEdgeInsets(top: 7, left: 0, bottom: 7, right: 0)
        row.addArrangedSubview(label(title, 14, .semibold, ink()))
        row.addArrangedSubview(spacer())
        let detailLabel = label(detail, 12, .regular, muted())
        detailLabel.lineBreakMode = .byWordWrapping
        detailLabel.maximumNumberOfLines = 2
        row.addArrangedSubview(detailLabel)
        return row
    }

    private func workspaceActionRow(_ title: String, _ detail: String, actionTitle: String, action: @escaping () -> Void) -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.edgeInsets = NSEdgeInsets(top: 7, left: 0, bottom: 7, right: 0)
        let text = NSStackView()
        text.orientation = .vertical
        text.spacing = 3
        text.addArrangedSubview(label(title, 14, .semibold, ink()))
        text.addArrangedSubview(mutedLabel(detail))
        row.addArrangedSubview(text)
        row.addArrangedSubview(spacer())
        row.addArrangedSubview(secondaryButton(actionTitle, action: action))
        return row
    }

    private func updateAdminStatus(username: String, status: String) {
        guard session?.can("admin_manage") == true,
              let token = UserDefaults.standard.string(forKey: "managerToken"),
              let actor = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        statusLabel.stringValue = status == "active" ? "正在启用管理员..." : "正在停用管理员..."
        request(
            path: "/api/admin/admins/\(username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username)/status",
            method: "PUT",
            body: ["status": status],
            token: token,
            username: actor
        ) { [weak self] json in
            DispatchQueue.main.async {
                guard let self else { return }
                if (json?["success"] as? Bool) == true {
                    self.statusLabel.stringValue = status == "active" ? "管理员已启用" : "管理员已停用"
                    self.showOperations()
                } else {
                    self.statusLabel.stringValue = json?["error"] as? String ?? "管理员状态更新失败"
                }
            }
        }
    }

    private func fetchWorkspaceSummary(completion: @escaping ([String: Any]?) -> Void) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            completion(nil)
            return
        }
        getJSON(path: "/api/admin/manager/workspace-summary", token: token, username: username, completion: completion)
    }

    private func roleLabel(_ role: String) -> String {
        ["super": "总管理员", "admin": "管理员", "operator": "运维", "editor": "编辑" ][role] ?? role
    }

    private func showNotices(inline: Bool = false) {
        if !inline {
            selectedSection = "notices"
            rebuildSidebar()
            content.arrangedSubviews.forEach { $0.removeFromSuperview() }
            content.addArrangedSubview(titleBlock("通知", subtitle: "后台信息与安全告警"))
        }
        let box = panel()
        let stack = cardStack(box)
        stack.addArrangedSubview(sectionTitle("最近告警"))
        fetchNotices { [weak stack] notices in
            DispatchQueue.main.async {
                guard let stack else { return }
                notices.prefix(5).forEach { notice in
                    stack.addArrangedSubview(self.noticeRow(notice))
                }
                if notices.isEmpty {
                    stack.addArrangedSubview(self.mutedLabel("暂无新通知"))
                }
            }
        }
        content.addArrangedSubview(box)
    }

    private func showFeedback(inline: Bool = false, trash: Bool = false) {
        guard let session, session.can("feedback_view") else {
            if !inline { showDashboard() }
            return
        }
        if !inline {
            selectedSection = "feedback"
            rebuildSidebar()
            content.arrangedSubviews.forEach { $0.removeFromSuperview() }
            content.addArrangedSubview(titleBlock("反馈中心", subtitle: trash ? "回收站" : "待处理队列"))
        }

        let box = panel()
        let stack = cardStack(box)
        let heading = NSStackView()
        heading.orientation = .horizontal
        heading.alignment = .centerY
        heading.spacing = 8
        heading.addArrangedSubview(sectionTitle(inline ? "反馈队列" : (trash ? "回收站" : "当前反馈")))
        heading.addArrangedSubview(spacer())
        if !inline {
            heading.addArrangedSubview(secondaryButton("处理中") { [weak self] in self?.showFeedback(trash: false) })
            heading.addArrangedSubview(secondaryButton("回收站") { [weak self] in self?.showFeedback(trash: true) })
        }
        stack.addArrangedSubview(heading)
        let loading = mutedLabel("正在读取反馈...")
        stack.addArrangedSubview(loading)
        content.addArrangedSubview(box)

        fetchFeedback(trash: trash) { [weak self, weak stack, weak loading] json in
            DispatchQueue.main.async {
                guard let self, let stack else { return }
                loading?.removeFromSuperview()
                guard let json,
                      (json["success"] as? Bool) == true,
                      let items = json["feedback"] as? [[String: Any]] else {
                    stack.addArrangedSubview(self.mutedLabel("无法读取反馈，请检查服务器连接"))
                    return
                }
                if let summary = json["summary"] as? [String: Any] {
                    let pending = (summary["new"] as? Int ?? 0) + (summary["reviewing"] as? Int ?? 0)
                    stack.addArrangedSubview(self.mutedLabel("待处理 \(pending) · 回收站 \(summary["trash"] as? Int ?? 0)"))
                }
                if items.isEmpty {
                    stack.addArrangedSubview(self.mutedLabel(trash ? "回收站为空" : "当前没有反馈"))
                    return
                }
                items.prefix(inline ? 3 : 100).forEach {
                    stack.addArrangedSubview(self.feedbackRow($0, trash: trash, compact: inline))
                }
                if inline && items.count > 3 {
                    stack.addArrangedSubview(self.secondaryButton("查看全部反馈") { [weak self] in self?.showFeedback() })
                }
            }
        }
    }

    private func feedbackRow(_ item: [String: Any], trash: Bool, compact: Bool) -> NSView {
        let row = NSStackView()
        row.orientation = .vertical
        row.spacing = 7
        row.edgeInsets = NSEdgeInsets(top: 12, left: 0, bottom: 12, right: 0)

        let top = NSStackView()
        top.orientation = .horizontal
        top.alignment = .centerY
        top.spacing = 10
        top.addArrangedSubview(label(item["category"] as? String ?? "体验反馈", 14, .semibold, ink()))
        top.addArrangedSubview(spacer())
        top.addArrangedSubview(chip(trash ? "回收站" : feedbackStatus(item["status"] as? String ?? "new")))
        row.addArrangedSubview(top)

        let message = label(item["message"] as? String ?? "无反馈内容", 13, .regular, ink())
        message.lineBreakMode = .byWordWrapping
        message.maximumNumberOfLines = compact ? 2 : 4
        row.addArrangedSubview(message)
        row.addArrangedSubview(mutedLabel([
            item["product"] as? String ?? "unknown",
            item["platform"] as? String ?? "unknown",
            item["account"] as? String ?? "匿名"
        ].joined(separator: " · ")))

        if compact {
            row.addArrangedSubview(secondaryButton("复制记录") { [weak self] in
                self?.copyFeedbackRecord(item)
            })
            return row
        }

        guard let id = item["id"] as? String else { return row }
        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 8
        actions.addArrangedSubview(secondaryButton("复制记录") { [weak self] in
            self?.copyFeedbackRecord(item)
        })
        if trash {
            if session?.can("feedback_delete") == true {
                actions.addArrangedSubview(secondaryButton("恢复") { [weak self] in
                    self?.mutateFeedback(id: id, suffix: "/restore", method: "POST", body: nil, trash: true)
                })
            }
            if session?.isSuper == true && session?.can("feedback_purge") == true {
                actions.addArrangedSubview(secondaryButton("永久删除") { [weak self] in
                    guard let self else { return }
                    let alert = NSAlert()
                    alert.messageText = "永久删除反馈？"
                    alert.informativeText = "此操作无法恢复。"
                    alert.addButton(withTitle: "永久删除")
                    alert.addButton(withTitle: "取消")
                    if alert.runModal() == .alertFirstButtonReturn {
                        self.mutateFeedback(id: id, suffix: "/purge", method: "DELETE", body: nil, trash: true)
                    }
                })
            }
        } else {
            if session?.can("feedback_manage") == true {
                actions.addArrangedSubview(primaryButton("处理") { [weak self] in self?.editFeedback(item) })
            }
            if session?.can("feedback_delete") == true {
                actions.addArrangedSubview(secondaryButton("移入回收站") { [weak self] in
                    self?.mutateFeedback(id: id, suffix: "", method: "DELETE", body: nil, trash: false)
                })
            }
        }
        actions.addArrangedSubview(spacer())
        row.addArrangedSubview(actions)
        return row
    }

    private func copyFeedbackRecord(_ item: [String: Any]) {
        let fields = [
            "反馈编号：\(item["id"] as? String ?? "-")",
            "产品：\(item["product"] as? String ?? "-")",
            "平台：\(item["platform"] as? String ?? "-")",
            "账号：\(item["account"] as? String ?? "匿名")",
            "联系方式：\(item["contact"] as? String ?? "-")",
            "分类：\(item["category"] as? String ?? "体验反馈")",
            "状态：\(feedbackStatus(item["status"] as? String ?? "new"))",
            "内容：\(item["message"] as? String ?? "")",
            "内部备注：\(item["note"] as? String ?? "-")",
            "提交时间：\(item["createdAt"] as? String ?? "-")"
        ]
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(fields.joined(separator: "\n"), forType: .string)
        statusLabel.stringValue = "反馈记录已复制"
    }

    private func editFeedback(_ item: [String: Any]) {
        guard let id = item["id"] as? String else { return }
        let alert = NSAlert()
        alert.messageText = item["category"] as? String ?? "处理反馈"
        alert.informativeText = item["message"] as? String ?? ""
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "取消")

        let fields = NSStackView()
        fields.orientation = .vertical
        fields.spacing = 8
        fields.frame = NSRect(x: 0, y: 0, width: 360, height: 70)
        let status = NSPopUpButton()
        status.addItems(withTitles: ["新反馈", "处理中", "已解决", "已归档"])
        let keys = ["new", "reviewing", "resolved", "archived"]
        status.selectItem(at: keys.firstIndex(of: item["status"] as? String ?? "new") ?? 0)
        let note = NSTextField(string: item["note"] as? String ?? "")
        note.placeholderString = "内部处理备注"
        fields.addArrangedSubview(status)
        fields.addArrangedSubview(note)
        alert.accessoryView = fields
        if alert.runModal() == .alertFirstButtonReturn {
            mutateFeedback(
                id: id,
                suffix: "",
                method: "PUT",
                body: ["status": keys[status.indexOfSelectedItem], "note": String(note.stringValue.prefix(2000))],
                trash: false
            )
        }
    }

    private func fetchFeedback(trash: Bool, completion: @escaping ([String: Any]?) -> Void) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            completion(nil)
            return
        }
        getJSON(path: "/api/admin/feedback?limit=100\(trash ? "&trash=1" : "")", token: token, username: username, completion: completion)
    }

    private func mutateFeedback(id: String, suffix: String, method: String, body: [String: Any]?, trash: Bool) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        request(
            path: "/api/admin/feedback/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)\(suffix)",
            method: method,
            body: body,
            token: token,
            username: username
        ) { [weak self] json in
            DispatchQueue.main.async {
                guard let self else { return }
                if (json?["success"] as? Bool) == true {
                    self.statusLabel.stringValue = "反馈已更新"
                    self.showFeedback(trash: trash)
                } else {
                    self.statusLabel.stringValue = json?["error"] as? String ?? "操作失败"
                }
            }
        }
    }

    private func feedbackStatus(_ status: String) -> String {
        ["new": "新反馈", "reviewing": "处理中", "resolved": "已解决", "archived": "已归档"][status] ?? status
    }

    private func showPermissions() {
        selectedSection = "permissions"
        rebuildSidebar()
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }
        content.addArrangedSubview(titleBlock("权限", subtitle: "当前账号可用能力"))
        let box = panel()
        let stack = cardStack(box)
        guard let session else {
            stack.addArrangedSubview(mutedLabel("未登录"))
            content.addArrangedSubview(box)
            return
        }
        let items = session.isSuper ? ["全部权限"] : session.permissions
        let flow = NSStackView()
        flow.orientation = .horizontal
        flow.spacing = 8
        items.prefix(16).forEach { flow.addArrangedSubview(chip(permissionLabel($0))) }
        stack.addArrangedSubview(flow)
        content.addArrangedSubview(box)
    }

    private func showInsights(inline: Bool = false) {
        if !inline {
            selectedSection = "insights"
            rebuildSidebar()
            content.arrangedSubviews.forEach { $0.removeFromSuperview() }
            content.addArrangedSubview(titleBlock("用户喜好池", subtitle: "实时偏好与提醒"))
        }
        let box = panel()
        let stack = cardStack(box)
        stack.addArrangedSubview(sectionTitle("喜好池"))
        guard let session, session.can("user_insights") else {
            stack.addArrangedSubview(mutedLabel("当前账号没有用户喜好洞察权限"))
            content.addArrangedSubview(box)
            return
        }
        fetchInsights { [weak self, weak stack] json in
            DispatchQueue.main.async {
                guard let self, let stack else { return }
                guard let json, (json["success"] as? Bool) == true else {
                    stack.addArrangedSubview(self.mutedLabel("无法读取喜好池"))
                    return
                }
                let summary = json["summary"] as? [String: Any] ?? [:]
                stack.addArrangedSubview(self.label("今日信号 \(summary["todaySignals"] ?? 0)", 15, .semibold, self.ink()))
                stack.addArrangedSubview(self.mutedLabel("热门模块：\(summary["topModule"] as? String ?? "暂无")"))
                if let today = json["today"] as? [String: Any], let modules = today["modules"] as? [[String: Any]] {
                    stack.addArrangedSubview(self.mono("今日模块\n" + self.insightList(modules)))
                }
                if let realtime = json["realtime"] as? [String: Any], let modules = realtime["modules"] as? [[String: Any]] {
                    stack.addArrangedSubview(self.mono("实时在线\n" + self.insightList(modules)))
                }
                stack.addArrangedSubview(self.secondaryButton("设置提醒时间") { [weak self] in self?.editInsightReminder(json: json) })
            }
        }
        content.addArrangedSubview(box)
    }

    private func insightList(_ items: [[String: Any]]) -> String {
        if items.isEmpty { return "暂无数据" }
        return items.prefix(5).map { "\($0["label"] as? String ?? "-")  \($0["count"] ?? 0)" }.joined(separator: "\n")
    }

    private func editInsightReminder(json: [String: Any]) {
        let settings = json["settings"] as? [String: Any] ?? [:]
        let input = NSTextField(string: "\(settings["intervalMinutes"] as? Int ?? 360)")
        input.placeholderString = "提醒间隔分钟"
        let alert = NSAlert()
        alert.messageText = "喜好池提醒"
        alert.informativeText = "设置 app 定期提醒你查看用户偏好。"
        alert.accessoryView = input
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn {
            let minutes = max(15, Int(input.stringValue) ?? 360)
            saveInsightSettings(minutes: minutes)
        }
    }

    private func showTerminalStatus(inline: Bool = false) {
        if !inline {
            selectedSection = "terminal"
            rebuildSidebar()
            content.arrangedSubviews.forEach { $0.removeFromSuperview() }
            content.addArrangedSubview(titleBlock("终端", subtitle: "Termux 命令工作区"))
        }
        let box = panel()
        let stack = cardStack(box)
        stack.addArrangedSubview(sectionTitle("终端"))
        guard let session, session.can("termux_terminal") else {
            stack.addArrangedSubview(mutedLabel("当前账号没有终端权限"))
            content.addArrangedSubview(box)
            return
        }
        let terminalStatus = mutedLabel("正在读取 Termux 状态...")
        stack.addArrangedSubview(terminalStatus)
        fetchTermuxStatus { [weak terminalStatus] text in
            DispatchQueue.main.async {
                terminalStatus?.stringValue = text
            }
        }

        terminalCommandField = NSTextField(string: "pm2 status")
        terminalCommandField.placeholderString = "输入命令，例如 pm2 status"
        terminalCommandField.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        terminalCommandField.heightAnchor.constraint(equalToConstant: 38).isActive = true
        stack.addArrangedSubview(formLabel("命令"))
        stack.addArrangedSubview(terminalCommandField)

        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 8
        actions.addArrangedSubview(primaryButton("执行") { [weak self] in self?.runTerminalCommand() })
        actions.addArrangedSubview(secondaryButton("复制输出") { [weak self] in self?.copyTerminalOutput() })
        actions.addArrangedSubview(secondaryButton("清空") { [weak self] in self?.clearTerminalOutput() })
        actions.addArrangedSubview(spacer())
        stack.addArrangedSubview(actions)

        terminalStandardOutput = NSTextView()
        terminalErrorOutput = NSTextView()
        stack.addArrangedSubview(terminalOutputBlock("标准输出", view: terminalStandardOutput, color: ink()))
        stack.addArrangedSubview(terminalOutputBlock("错误输出", view: terminalErrorOutput, color: .systemRed))
        content.addArrangedSubview(box)
    }

    private func runTerminalCommand() {
        guard let session, session.can("termux_terminal") else {
            showDashboard()
            return
        }
        let command = terminalCommandField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else {
            statusLabel.stringValue = "请输入命令"
            return
        }
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        terminalStandardOutput.string = "正在执行..."
        terminalErrorOutput.string = ""
        statusLabel.stringValue = "命令执行中"
        postJSON(path: "/api/admin/termux/command", body: ["command": command, "timeoutMs": 15000], token: token, username: username) { [weak self] json in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let json else {
                    self.terminalStandardOutput.string = ""
                    self.terminalErrorOutput.string = "服务器未返回有效数据"
                    self.statusLabel.stringValue = "命令执行失败"
                    return
                }
                self.terminalStandardOutput.string = (json["stdout"] as? String ?? "").trimmingCharacters(in: .newlines)
                self.terminalErrorOutput.string = (json["stderr"] as? String ?? json["error"] as? String ?? "").trimmingCharacters(in: .newlines)
                let exitCode = json["exitCode"] as? Int ?? json["code"] as? Int
                self.statusLabel.stringValue = exitCode.map { "命令已结束，退出码 \($0)" } ?? "命令已结束"
            }
        }
    }

    private func copyTerminalOutput() {
        let output = [
            "$ \(terminalCommandField.stringValue)",
            "[标准输出]\n\(terminalStandardOutput.string)",
            "[错误输出]\n\(terminalErrorOutput.string)"
        ].joined(separator: "\n")
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(output, forType: .string)
        statusLabel.stringValue = "终端输出已复制"
    }

    private func clearTerminalOutput() {
        terminalStandardOutput.string = ""
        terminalErrorOutput.string = ""
        statusLabel.stringValue = "输出已清空"
    }

    private func terminalOutputBlock(_ title: String, view: NSTextView, color: NSColor) -> NSView {
        let block = NSStackView()
        block.orientation = .vertical
        block.spacing = 6
        block.addArrangedSubview(formLabel(title))
        let outputHeight: CGFloat = title == "标准输出" ? 170 : 100
        view.frame = NSRect(x: 0, y: 0, width: 680, height: outputHeight)
        view.minSize = NSSize(width: 0, height: outputHeight)
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = true
        view.autoresizingMask = [.width]
        view.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.isEditable = false
        view.isSelectable = true
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.textColor = color
        view.backgroundColor = NSColor(red: 0.96, green: 0.97, blue: 0.97, alpha: 1)
        view.textContainerInset = NSSize(width: 10, height: 10)
        let scroll = NSScrollView()
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.borderType = .lineBorder
        scroll.heightAnchor.constraint(equalToConstant: outputHeight).isActive = true
        block.addArrangedSubview(scroll)
        return block
    }

    private func fetchSession(username: String, token: String, completion: @escaping (Result<AdminSession, Error>) -> Void) {
        getJSON(path: "/api/admin/session", token: token, username: username) { json in
            guard let json, (json["success"] as? Bool) == true else {
                completion(.failure(NSError(domain: "session", code: 1)))
                return
            }
            completion(.success(AdminSession(
                username: json["username"] as? String ?? username,
                role: json["role"] as? String ?? "admin",
                permissions: json["permissions"] as? [String] ?? []
            )))
        }
    }

    private func fetchNotices(completion: @escaping ([Notice]) -> Void) {
        guard let url = URL(string: notificationFeedURL) else { completion([]); return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            let notices = self.parseNotices(data)
            completion(notices)
        }.resume()
    }

    private func pollNotices() {
        fetchNotices { notices in
            guard let latest = notices.first, latest.id != self.lastNoticeId else { return }
            self.lastNoticeId = latest.id
            UserDefaults.standard.set(latest.id, forKey: "managerLastNoticeId")
            self.notify(latest)
        }
    }

    private func notify(_ notice: Notice) {
        DispatchQueue.main.async {
            self.statusLabel.stringValue = "\(self.levelLabel(notice.level))：\(notice.title)"
        }
        let content = UNMutableNotificationContent()
        content.title = "\(levelLabel(notice.level))：\(notice.title)"
        content.body = notice.body
        content.sound = notice.level == "critical" ? .defaultCritical : .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: notice.id, content: content, trigger: nil))
    }

    private func fetchTermuxStatus(completion: @escaping (String) -> Void) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            completion("未登录")
            return
        }
        getJSON(path: "/api/admin/termux/status", token: token, username: username) { json in
            guard let json,
                  (json["success"] as? Bool) == true,
                  let status = json["status"] as? [String: Any] else {
                completion("无法读取终端状态")
                return
            }
            completion("host \(status["hostname"] ?? "-")\nnode \(status["node"] ?? "-")\ncwd  \(status["cwd"] ?? "-")")
        }
    }

    private func fetchInsights(completion: @escaping ([String: Any]?) -> Void) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            completion(nil)
            return
        }
        getJSON(path: "/api/admin/user-insights", token: token, username: username, completion: completion)
    }

    private func saveInsightSettings(minutes: Int) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            statusLabel.stringValue = "请先登录"
            return
        }
        postJSON(path: "/api/admin/user-insights/settings", body: ["enabled": true, "intervalMinutes": minutes], token: token, username: username) { [weak self] json in
            DispatchQueue.main.async {
                self?.statusLabel.stringValue = (json?["success"] as? Bool) == true ? "提醒已保存" : "保存失败"
            }
        }
    }

    private func checkUpdates(manual: Bool) {
        fetchAvailableUpdate { update in
            DispatchQueue.main.async {
                guard let update else {
                    if manual { self.statusLabel.stringValue = "已是最新版本" }
                    return
                }
                self.statusLabel.stringValue = "发现新版本 \(update.version)"
                self.notifyUpdate(update)
                let promptKey = "managerLastUpdatePromptBuild"
                if manual || UserDefaults.standard.integer(forKey: promptKey) != update.build {
                    UserDefaults.standard.set(update.build, forKey: promptKey)
                    self.presentUpdatePrompt(update)
                }
            }
        }
    }

    private func presentUpdatePrompt(_ update: AppUpdate) {
        let alert = NSAlert()
        alert.messageText = "发现新版本"
        alert.informativeText = "铮铮控制台 \(update.version) 已发布。将下载到 Downloads 并打开系统安装器。"
        alert.addButton(withTitle: "下载并安装")
        alert.addButton(withTitle: "稍后")
        if alert.runModal() == .alertFirstButtonReturn {
            downloadAndOpen(update)
        }
    }

    private func fetchAvailableUpdate(completion: @escaping (AppUpdate?) -> Void) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            completion(nil)
            return
        }
        getJSON(path: "/api/admin/manager/apps", token: token, username: username) { json in
            guard let json,
                  let apps = json["apps"] as? [[String: Any]],
                  let item = apps.first(where: { ($0["id"] as? String) == updateId }) else {
                completion(nil)
                return
            }
            let remoteBuild = item["build"] as? Int ?? item["versionCode"] as? Int ?? 0
            guard remoteBuild > appBuild,
                  let fileName = item["fileName"] as? String,
                  !fileName.isEmpty else {
                completion(nil)
                return
            }
            completion(AppUpdate(
                fileName: fileName,
                version: item["version"] as? String ?? item["versionName"] as? String ?? "",
                build: remoteBuild,
                size: item["fileSize"] as? Int ?? item["size"] as? Int ?? 0
            ))
        }
    }

    private func notifyUpdate(_ update: AppUpdate) {
        let key = "managerLastUpdateNoticeBuild"
        if UserDefaults.standard.integer(forKey: key) == update.build { return }
        UserDefaults.standard.set(update.build, forKey: key)
        let content = UNMutableNotificationContent()
        content.title = "铮铮控制台有新版本"
        content.body = "v\(update.version) 可用，可下载到 Downloads 后打开安装器。"
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "manager-update-\(update.build)", content: content, trigger: nil))
    }

    private func downloadAndOpen(_ update: AppUpdate) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            statusLabel.stringValue = "请先登录"
            return
        }
        let tokenPath = "/api/admin/manager/apps/download-token?file=\(update.fileName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? update.fileName)"
        getJSON(path: tokenPath, token: token, username: username) { json in
            guard let downloadPath = json?["downloadURL"] as? String,
                  let downloadURL = URL(string: downloadPath.hasPrefix("http") ? downloadPath : siteRoot + downloadPath) else {
                DispatchQueue.main.async { self.statusLabel.stringValue = "生成下载票据失败" }
                return
            }
            DispatchQueue.main.async { self.statusLabel.stringValue = "正在下载 \(update.version)..." }
            URLSession.shared.downloadTask(with: downloadURL) { tempURL, _, error in
                guard let tempURL, error == nil else {
                    DispatchQueue.main.async { self.statusLabel.stringValue = "下载失败" }
                    return
                }
                let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                    ?? FileManager.default.homeDirectoryForCurrentUser
                let destination = downloads.appendingPathComponent(update.fileName)
                do {
                    if FileManager.default.fileExists(atPath: destination.path) {
                        try FileManager.default.removeItem(at: destination)
                    }
                    try FileManager.default.moveItem(at: tempURL, to: destination)
                    DispatchQueue.main.async {
                        self.statusLabel.stringValue = "已下载到 Downloads"
                        NSWorkspace.shared.open(destination)
                    }
                } catch {
                    DispatchQueue.main.async { self.statusLabel.stringValue = "保存到 Downloads 失败" }
                }
            }.resume()
        }
    }

    private func getJSON(path: String, token: String?, username: String?, completion: @escaping ([String: Any]?) -> Void) {
        request(path: path, method: "GET", body: nil, token: token, username: username, completion: completion)
    }

    private func postJSON(path: String, body: [String: Any], token: String?, username: String?, completion: @escaping ([String: Any]?) -> Void) {
        request(path: path, method: "POST", body: body, token: token, username: username, completion: completion)
    }

    private func request(path: String, method: String, body: [String: Any]?, token: String?, username: String?, completion: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: siteRoot + path) else { completion(nil); return }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("ManagerPortal/macOS-\(appVersion)", forHTTPHeaderField: "X-Manager-Native")
        if let token { req.setValue(token, forHTTPHeaderField: "x-admin-token") }
        if let username { req.setValue(username.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? username, forHTTPHeaderField: "x-admin-username") }
        if let body { req.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                completion(nil)
                return
            }
            completion(json)
        }.resume()
    }

    private func parseNotices(_ data: Data?) -> [Notice] {
        guard let data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = json["items"] as? [[String: Any]] else { return [] }
        return items.map {
            Notice(
                id: $0["id"] as? String ?? UUID().uuidString,
                title: $0["title"] as? String ?? "通知",
                body: $0["body"] as? String ?? "",
                level: $0["level"] as? String ?? "info",
                createdAt: $0["createdAt"] as? String ?? ""
            )
        }
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
    }

    private func titleBlock(_ title: String, subtitle: String) -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 4
        stack.addArrangedSubview(label(title, 30, .bold, ink()))
        stack.addArrangedSubview(label(subtitle, 13, .medium, muted()))
        return stack
    }

    private func panel() -> NSView {
        let view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.white.cgColor
        view.layer?.borderColor = NSColor(red: 0.86, green: 0.89, blue: 0.91, alpha: 1).cgColor
        view.layer?.borderWidth = 1
        view.layer?.cornerRadius = 12
        return view
    }

    private func cardStack(_ card: NSView) -> NSStackView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 22, bottom: 20, right: 22)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor)
        ])
        return stack
    }

    private func summaryCard(_ title: String, _ value: String, _ symbol: String) -> NSView {
        let box = panel()
        let stack = cardStack(box)
        stack.addArrangedSubview(label(title, 12, .medium, muted()))
        stack.addArrangedSubview(label(value, 24, .bold, ink()))
        return box
    }

    private func noticeRow(_ notice: Notice) -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 10
        row.addArrangedSubview(dot(notice.level))
        let text = NSStackView()
        text.orientation = .vertical
        text.spacing = 2
        text.addArrangedSubview(label(notice.title, 14, .semibold, ink()))
        text.addArrangedSubview(label(notice.body, 12, .regular, muted()))
        row.addArrangedSubview(text)
        row.addArrangedSubview(spacer())
        row.addArrangedSubview(label(levelLabel(notice.level), 12, .medium, muted()))
        return row
    }

    private func navButton(_ text: String, symbol: String, section: String, action: @escaping () -> Void) -> NSButton {
        let button = NSButton(title: text, target: nil, action: nil)
        button.isBordered = false
        button.alignment = .left
        button.font = .systemFont(ofSize: 14, weight: .medium)
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: text)
        button.imagePosition = .imageLeading
        button.imageHugsTitle = true
        button.contentTintColor = section == selectedSection
            ? NSColor(red: 0.46, green: 0.78, blue: 0.64, alpha: 1)
            : NSColor(red: 0.70, green: 0.74, blue: 0.76, alpha: 1)
        button.attributedTitle = NSAttributedString(
            string: text,
            attributes: [
                .foregroundColor: section == selectedSection ? NSColor.white : NSColor(red: 0.78, green: 0.81, blue: 0.83, alpha: 1),
                .font: NSFont.systemFont(ofSize: 14, weight: .medium)
            ]
        )
        button.wantsLayer = true
        button.layer?.cornerRadius = 8
        button.layer?.backgroundColor = section == selectedSection
            ? NSColor(red: 0.15, green: 0.18, blue: 0.20, alpha: 1).cgColor
            : NSColor.clear.cgColor
        button.heightAnchor.constraint(equalToConstant: 38).isActive = true
        bindControlAction(button, handler: action)
        return button
    }

    private func sidebarLabel(_ text: String) -> NSTextField {
        let field = label(text, 11, .semibold, NSColor(red: 0.52, green: 0.57, blue: 0.60, alpha: 1))
        field.translatesAutoresizingMaskIntoConstraints = false
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: 24).isActive = true
        return field
    }

    private func primaryButton(_ text: String, action: @escaping () -> Void) -> NSButton {
        let button = NSButton(title: text, target: nil, action: nil)
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"
        bindControlAction(button, handler: action)
        return button
    }

    private func secondaryButton(_ text: String, action: @escaping () -> Void) -> NSButton {
        let button = NSButton(title: text, target: nil, action: nil)
        button.bezelStyle = .rounded
        button.font = .systemFont(ofSize: 13, weight: .medium)
        bindControlAction(button, handler: action)
        return button
    }

    private func label(_ text: String, _ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = color
        field.lineBreakMode = .byTruncatingTail
        return field
    }

    private func formLabel(_ text: String) -> NSTextField { label(text, 12, .semibold, muted()) }
    private func sectionTitle(_ text: String) -> NSTextField { label(text, 18, .bold, ink()) }
    private func mutedLabel(_ text: String) -> NSTextField { label(text, 13, .regular, muted()) }

    private func mono(_ text: String) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        field.textColor = ink()
        return field
    }

    private func chip(_ text: String) -> NSTextField {
        let field = label(text, 12, .medium, NSColor(red: 0.08, green: 0.38, blue: 0.24, alpha: 1))
        field.wantsLayer = true
        field.layer?.backgroundColor = NSColor(red: 0.91, green: 0.97, blue: 0.93, alpha: 1).cgColor
        field.layer?.cornerRadius = 8
        return field
    }

    private func dot(_ level: String) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        view.layer?.cornerRadius = 5
        view.layer?.backgroundColor = (level == "critical" ? NSColor.systemRed : level == "warning" ? NSColor.systemOrange : NSColor.systemGreen).cgColor
        view.widthAnchor.constraint(equalToConstant: 10).isActive = true
        view.heightAnchor.constraint(equalToConstant: 10).isActive = true
        return view
    }

    private func spacer() -> NSView {
        let view = NSView()
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        return view
    }

    private func gap(_ height: CGFloat) -> NSView {
        let view = NSView()
        view.heightAnchor.constraint(equalToConstant: height).isActive = true
        return view
    }

    private func levelLabel(_ level: String) -> String {
        if level == "critical" { return "重大" }
        if level == "warning" { return "提醒" }
        return "信息"
    }

    private func permissionLabel(_ id: String) -> String {
        let names = [
                "*": "全部权限", "system_check": "系统检查", "logs_view": "日志查看",
                "admin_manage": "管理员", "security_manage": "安全", "alerts_manage": "通知",
                "termux_terminal": "终端", "code_edit": "源码", "app_manage": "应用", "user_insights": "喜好",
                "feedback_view": "反馈查看", "feedback_manage": "反馈处理",
                "feedback_delete": "反馈回收站", "feedback_purge": "反馈永久删除"
            ]
        return names[id] ?? id
    }

    private func ink() -> NSColor { NSColor(red: 0.10, green: 0.13, blue: 0.16, alpha: 1) }
    private func muted() -> NSColor { NSColor(red: 0.38, green: 0.43, blue: 0.48, alpha: 1) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
