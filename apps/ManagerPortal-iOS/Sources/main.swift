import UIKit
import Foundation
import UserNotifications

private let appVersion = "1.5.2"
private let appBuild = 14
private let updateId = "manager-portal-ios"
private let siteRoot = "https://zhengzhengstudio.cn"
private let notificationFeedURL = URL(string: "https://zhengzhengstudio.cn/api/manager/notifications?limit=20")!

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
}

struct AppUpdate {
    let fileName: String
    let version: String
    let build: Int
}

private struct ContentHTTPResult {
    let statusCode: Int
    let json: [String: Any]?
    let requestToken: String?
    let requestUsername: String?
}

final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = ManagerPortalViewController()
        window?.makeKeyAndVisible()
        return true
    }
}

final class ManagerPortalViewController: UIViewController, UITabBarDelegate {
    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let tabBar = UITabBar()
    private let statusLabel = UILabel()
    private let usernameField = UITextField()
    private let passwordField = UITextField()
    private var terminalCommandField = UITextField()
    private var terminalStandardOutput = UITextView()
    private var terminalErrorOutput = UITextView()
    private var session: AdminSession?
    private var lastNoticeId = UserDefaults.standard.string(forKey: "managerLastNoticeId") ?? ""
    private var noticeTimer: Timer?
    private var updateTimer: Timer?
    private var contentWorkspaces: [String: [String: Any]] = [:]
    private var contentGeneration = 0
    private var currentContentModule: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bgColor()
        buildShell()
        restoreSession()
        pollNotices()
        noticeTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.pollNotices()
        }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 1800, repeats: true) { [weak self] _ in
            self?.checkUpdates(manual: false)
        }
    }

    private func buildShell() {
        let header = UIStackView()
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 10
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)

        let icon = UIImageView(image: UIImage(named: "AppIcon") ?? UIImage(systemName: "shield.lefthalf.filled"))
        icon.tintColor = green()
        icon.contentMode = .scaleAspectFit
        header.addArrangedSubview(icon)
        icon.widthAnchor.constraint(equalToConstant: 34).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 34).isActive = true
        header.addArrangedSubview(label("铮铮控制台", 21, .bold, ink()))
        header.addArrangedSubview(flex())
        statusLabel.text = "未登录"
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.textColor = muted()
        header.addArrangedSubview(statusLabel)

        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)

        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.isHidden = true
        tabBar.backgroundColor = .white
        tabBar.tintColor = green()
        tabBar.unselectedItemTintColor = muted()
        view.addSubview(tabBar)

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 14),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: tabBar.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 10),
            stack.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -28),
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tabBar.heightAnchor.constraint(equalToConstant: 74)
        ])
    }

    private func buildBottomNavigation(selected index: Int) {
        var items = [
            UITabBarItem(title: "总览", image: UIImage(systemName: "rectangle.grid.2x2"), tag: 0),
            UITabBarItem(title: "事务", image: UIImage(systemName: "tray.full"), tag: 1)
        ]
        items.append(UITabBarItem(title: "工作台", image: UIImage(systemName: "square.grid.2x2"), tag: 3))
        items.append(UITabBarItem(title: "账户", image: UIImage(systemName: "person.crop.circle"), tag: 4))
        tabBar.items = items
        tabBar.selectedItem = tabBar.items?.first(where: { $0.tag == index })
        tabBar.isHidden = session == nil
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        switch item.tag {
        case 1: showQueue()
        case 3: showTools()
        case 4: showAccount()
        default: showDashboard()
        }
    }

    private func restoreSession() {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername"),
              !token.isEmpty, !username.isEmpty else {
            showLogin()
            return
        }
        getJSON(path: "/api/admin/session", token: token, username: username) { [weak self] json in
            DispatchQueue.main.async {
                guard let json, (json["success"] as? Bool) == true else {
                    self?.showLogin()
                    return
                }
                self?.session = AdminSession(
                    username: json["username"] as? String ?? username,
                    role: json["role"] as? String ?? "admin",
                    permissions: json["permissions"] as? [String] ?? []
                )
                self?.statusLabel.text = "已授权"
                self?.showDashboard()
                self?.checkUpdates(manual: false)
            }
        }
    }

    private func showLogin() {
        session = nil
        invalidateContentWorkspaceState()
        tabBar.isHidden = true
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        statusLabel.text = "未登录"
        stack.addArrangedSubview(titleBlock("铮铮控制台", "管理员验证"))
        let card = panel()
        let inner = VStack(card)
        usernameField.placeholder = "账号"
        usernameField.borderStyle = .roundedRect
        passwordField.placeholder = "密码"
        passwordField.isSecureTextEntry = true
        passwordField.borderStyle = .roundedRect
        inner.addArrangedSubview(formLabel("管理员账号"))
        inner.addArrangedSubview(usernameField)
        inner.addArrangedSubview(formLabel("管理员密码"))
        inner.addArrangedSubview(passwordField)
        inner.addArrangedSubview(primaryButton("管理员登录") { [weak self] in self?.login() })
        inner.addArrangedSubview(secondaryButton("通行证登录") { [weak self] in self?.passportLogin() })
        stack.addArrangedSubview(card)
    }

    private func login() {
        let username = usernameField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let password = passwordField.text ?? ""
        guard !username.isEmpty, !password.isEmpty else {
            statusLabel.text = "请输入账号和密码"
            return
        }
        statusLabel.text = "正在验证..."
        postJSON(path: "/api/admin/verify-password", body: ["username": username, "password": password, "managerCompat": true], token: nil, username: nil) { [weak self] json in
            DispatchQueue.main.async {
                guard let json,
                      (json["success"] as? Bool) == true,
                      let token = json["token"] as? String else {
                    self?.statusLabel.text = "验证失败"
                    return
                }
                self?.acceptAdminSession(
                    username: username,
                    token: token,
                    role: json["role"] as? String ?? "admin",
                    permissions: json["permissions"] as? [String] ?? []
                )
            }
        }
    }

    private func passportLogin() {
        let account = usernameField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let password = passwordField.text ?? ""
        guard !account.isEmpty, !password.isEmpty else {
            statusLabel.text = "请输入通行证账号和密码"
            return
        }
        statusLabel.text = "正在验证通行证..."
        postJSON(path: "/api/auth/login", body: ["username": account, "password": password, "managerCompat": true], token: nil, username: nil) { [weak self] json in
            guard let user = json?["user"] as? [String: Any],
                  let uid = user["uid"] ?? user["id"] else {
                DispatchQueue.main.async { self?.statusLabel.text = json?["error"] as? String ?? "通行证验证失败" }
                return
            }
            let authToken = user["authToken"] as? String ?? ""
            self?.postJSON(path: "/api/admin/passport-login", body: ["passportUid": "\(uid)", "authToken": authToken, "managerCompat": true], token: nil, username: nil) { adminJson in
                DispatchQueue.main.async {
                    guard let adminJson,
                          (adminJson["success"] as? Bool) == true,
                          let token = adminJson["token"] as? String else {
                        self?.statusLabel.text = adminJson?["error"] as? String ?? "通行证账号无管理员权限"
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
        statusLabel.text = "已授权"
        showDashboard()
        checkUpdates(manual: false)
    }

    private func showDashboard() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard let session else { showLogin(); return }
        buildBottomNavigation(selected: 0)
        stack.addArrangedSubview(titleBlock("总览", session.username))
        let stats = UIStackView()
        stats.axis = .vertical
        stats.spacing = 10
        stats.addArrangedSubview(statRow("会话", "有效"))
        stats.addArrangedSubview(statRow("权限", session.isSuper ? "全部" : "\(session.permissions.count)"))
        stats.addArrangedSubview(statRow("版本", appVersion))
        let card = panel()
        VStack(card).addArrangedSubview(stats)
        stack.addArrangedSubview(card)
        showNotices(inline: true)
        let actions = panel()
        let actionStack = VStack(actions)
        actionStack.addArrangedSubview(sectionTitle("常用操作"))
        actionStack.addArrangedSubview(toolButton("打开工作台", symbol: "square.grid.2x2") { [weak self] in self?.showOperations() })
        if session.can("feedback_view") {
            actionStack.addArrangedSubview(toolButton("处理反馈", symbol: "text.bubble") { [weak self] in self?.showFeedback() })
        }
        stack.addArrangedSubview(actions)
    }

    private func showQueue() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(titleBlock("事务", "告警与反馈集中处理"))
        buildBottomNavigation(selected: 1)
        showNotices(inline: true)
        if session?.can("feedback_view") == true {
            showFeedback(inline: true)
        } else {
            let card = panel()
            VStack(card).addArrangedSubview(small("当前账号没有反馈查看权限"))
            stack.addArrangedSubview(card)
        }
    }

    private func logout() {
        UserDefaults.standard.removeObject(forKey: "managerToken")
        UserDefaults.standard.removeObject(forKey: "managerUsername")
        showLogin()
    }

    private func showNotices(inline: Bool = false) {
        if !inline {
            stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            stack.addArrangedSubview(titleBlock("通知", "后台信息与安全告警"))
            buildBottomNavigation(selected: 1)
        }
        let card = panel()
        let inner = VStack(card)
        inner.addArrangedSubview(sectionTitle("最近告警"))
        fetchNotices { [weak inner] notices in
            DispatchQueue.main.async {
                if notices.isEmpty { inner?.addArrangedSubview(self.small("暂无新通知")) }
                notices.prefix(6).forEach { inner?.addArrangedSubview(self.noticeRow($0)) }
            }
        }
        stack.addArrangedSubview(card)
    }

    private func showFeedback(inline: Bool = false, trash: Bool = false) {
        guard let session, session.can("feedback_view") else {
            if !inline { showDashboard() }
            return
        }
        if !inline {
            stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            stack.addArrangedSubview(titleBlock("反馈中心", trash ? "回收站" : "待处理队列"))
            buildBottomNavigation(selected: 1)
        }

        let card = panel()
        let inner = VStack(card)
        let heading = UIStackView()
        heading.axis = .horizontal
        heading.alignment = .center
        heading.spacing = 8
        heading.addArrangedSubview(sectionTitle(inline ? "反馈队列" : (trash ? "回收站" : "当前反馈")))
        heading.addArrangedSubview(flex())
        if !inline {
            heading.addArrangedSubview(secondaryButton("处理中") { [weak self] in self?.showFeedback(trash: false) })
            heading.addArrangedSubview(secondaryButton("回收站") { [weak self] in self?.showFeedback(trash: true) })
        }
        inner.addArrangedSubview(heading)
        let loading = small("正在读取反馈...")
        inner.addArrangedSubview(loading)
        stack.addArrangedSubview(card)

        fetchFeedback(trash: trash) { [weak self, weak inner, weak loading] json in
            DispatchQueue.main.async {
                guard let self, let inner else { return }
                loading?.removeFromSuperview()
                guard let json,
                      (json["success"] as? Bool) == true,
                      let items = json["feedback"] as? [[String: Any]] else {
                    inner.addArrangedSubview(self.small("无法读取反馈，请检查服务器连接"))
                    return
                }
                if let summary = json["summary"] as? [String: Any] {
                    let pending = (summary["new"] as? Int ?? 0) + (summary["reviewing"] as? Int ?? 0)
                    inner.addArrangedSubview(self.small("待处理 \(pending) · 回收站 \(summary["trash"] as? Int ?? 0)"))
                }
                if items.isEmpty {
                    inner.addArrangedSubview(self.small(trash ? "回收站为空" : "当前没有反馈"))
                    return
                }
                items.prefix(inline ? 3 : 100).forEach {
                    inner.addArrangedSubview(self.feedbackRow($0, trash: trash, compact: inline))
                }
                if inline && items.count > 3 {
                    inner.addArrangedSubview(self.secondaryButton("查看全部反馈") { [weak self] in self?.showFeedback() })
                }
            }
        }
    }

    private func feedbackRow(_ item: [String: Any], trash: Bool, compact: Bool) -> UIView {
        let row = UIStackView()
        row.axis = .vertical
        row.spacing = 7
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 11, left: 0, bottom: 11, right: 0)

        let top = UIStackView()
        top.axis = .horizontal
        top.alignment = .center
        top.addArrangedSubview(label(item["category"] as? String ?? "体验反馈", 14, .semibold, ink()))
        top.addArrangedSubview(flex())
        top.addArrangedSubview(label(trash ? "回收站" : feedbackStatus(item["status"] as? String ?? "new"), 12, .semibold, green()))
        row.addArrangedSubview(top)

        let message = label(item["message"] as? String ?? "无反馈内容", 13, .regular, ink())
        message.numberOfLines = compact ? 2 : 4
        row.addArrangedSubview(message)
        row.addArrangedSubview(small([
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
        let actions = UIStackView()
        actions.axis = .horizontal
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
                actions.addArrangedSubview(secondaryButton("永久删除") { [weak self] in self?.confirmPurgeFeedback(id) })
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
        actions.addArrangedSubview(flex())
        row.addArrangedSubview(actions)
        return row
    }

    private func copyFeedbackRecord(_ item: [String: Any]) {
        UIPasteboard.general.string = [
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
        ].joined(separator: "\n")
        statusLabel.text = "反馈记录已复制"
    }

    private func editFeedback(_ item: [String: Any]) {
        guard let id = item["id"] as? String else { return }
        let alert = UIAlertController(
            title: item["category"] as? String ?? "处理反馈",
            message: item["message"] as? String ?? "",
            preferredStyle: .alert
        )
        alert.addTextField {
            $0.placeholder = "内部处理备注"
            $0.text = item["note"] as? String ?? ""
        }
        [
            ("处理中", "reviewing"),
            ("已解决", "resolved"),
            ("已归档", "archived"),
            ("标为新反馈", "new")
        ].forEach { choice in
            let (label, status) = choice
            alert.addAction(UIAlertAction(title: label, style: .default) { [weak self, weak alert] _ in
                self?.mutateFeedback(
                    id: id,
                    suffix: "",
                    method: "PUT",
                    body: ["status": status, "note": String((alert?.textFields?.first?.text ?? "").prefix(2000))],
                    trash: false
                )
            })
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    private func confirmPurgeFeedback(_ id: String) {
        let alert = UIAlertController(title: "永久删除反馈？", message: "此操作无法恢复。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "永久删除", style: .destructive) { [weak self] _ in
            self?.mutateFeedback(id: id, suffix: "/purge", method: "DELETE", body: nil, trash: true)
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
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
                    self.statusLabel.text = "反馈已更新"
                    self.showFeedback(trash: trash)
                } else {
                    self.statusLabel.text = json?["error"] as? String ?? "操作失败"
                }
            }
        }
    }

    private func feedbackStatus(_ status: String) -> String {
        ["new": "新反馈", "reviewing": "处理中", "resolved": "已解决", "archived": "已归档"][status] ?? status
    }

    private func showPermissions() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(titleBlock("权限", "当前账号可用能力"))
        let card = panel()
        let inner = VStack(card)
        let text = session?.isSuper == true ? "全部权限" : (session?.permissions.map(permissionLabel).joined(separator: " / ") ?? "未登录")
        inner.addArrangedSubview(label(text, 14, .medium, ink()))
        stack.addArrangedSubview(card)
    }

    private func showInsights(inline: Bool = false) {
        if !inline {
            stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            stack.addArrangedSubview(titleBlock("用户喜好池", "实时偏好与提醒"))
        }
        let card = panel()
        let inner = VStack(card)
        inner.addArrangedSubview(sectionTitle("喜好池"))
        guard let session, session.can("user_insights") else {
            inner.addArrangedSubview(small("当前账号没有用户喜好洞察权限"))
            stack.addArrangedSubview(card)
            return
        }
        fetchInsights { [weak self, weak inner] json in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let json, (json["success"] as? Bool) == true else {
                    inner?.addArrangedSubview(self.small("无法读取喜好池"))
                    return
                }
                let summary = json["summary"] as? [String: Any] ?? [:]
                inner?.addArrangedSubview(self.statRow("今日信号", "\(summary["todaySignals"] ?? 0)"))
                inner?.addArrangedSubview(self.small("热门模块：\(summary["topModule"] as? String ?? "暂无")"))
                if let today = json["today"] as? [String: Any], let modules = today["modules"] as? [[String: Any]] {
                    inner?.addArrangedSubview(self.mono("今日模块\n" + self.insightList(modules)))
                }
                if let realtime = json["realtime"] as? [String: Any], let modules = realtime["modules"] as? [[String: Any]] {
                    inner?.addArrangedSubview(self.mono("实时在线\n" + self.insightList(modules)))
                }
                inner?.addArrangedSubview(self.secondaryButton("设置提醒时间") { [weak self] in self?.editInsightReminder(json: json) })
            }
        }
        stack.addArrangedSubview(card)
    }

    private func insightList(_ items: [[String: Any]]) -> String {
        if items.isEmpty { return "暂无数据" }
        return items.prefix(5).map { "\($0["label"] as? String ?? "-")  \($0["count"] ?? 0)" }.joined(separator: "\n")
    }

    private func editInsightReminder(json: [String: Any]) {
        let settings = json["settings"] as? [String: Any] ?? [:]
        let alert = UIAlertController(title: "喜好池提醒", message: "设置 app 定期提醒你查看用户偏好。", preferredStyle: .alert)
        alert.addTextField { field in
            field.keyboardType = .numberPad
            field.placeholder = "提醒间隔分钟"
            field.text = "\(settings["intervalMinutes"] as? Int ?? 360)"
        }
        alert.addAction(UIAlertAction(title: "保存", style: .default) { [weak self, weak alert] _ in
            let minutes = max(15, Int(alert?.textFields?.first?.text ?? "") ?? 360)
            self?.saveInsightSettings(minutes: minutes)
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    private func showTerminal(inline: Bool = false) {
        if !inline {
            stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
            stack.addArrangedSubview(titleBlock("终端", "Termux 命令工作区"))
        }
        let card = panel()
        let inner = VStack(card)
        inner.addArrangedSubview(sectionTitle("终端"))
        guard let session, session.can("termux_terminal") else {
            inner.addArrangedSubview(small("当前账号没有终端权限"))
            stack.addArrangedSubview(card)
            return
        }
        let terminalStatus = small("正在读取 Termux 状态...")
        inner.addArrangedSubview(terminalStatus)
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        getJSON(path: "/api/admin/termux/status", token: token, username: username) { [weak terminalStatus] json in
            DispatchQueue.main.async {
                guard let json,
                      (json["success"] as? Bool) == true,
                      let status = json["status"] as? [String: Any] else {
                    terminalStatus?.text = "无法读取终端状态"
                    return
                }
                terminalStatus?.text = "host \(status["hostname"] ?? "-") · node \(status["node"] ?? "-") · cwd \(status["cwd"] ?? "-")"
            }
        }

        terminalCommandField = UITextField()
        terminalCommandField.text = "pm2 status"
        terminalCommandField.placeholder = "输入命令，例如 pm2 status"
        terminalCommandField.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        terminalCommandField.autocapitalizationType = .none
        terminalCommandField.autocorrectionType = .no
        terminalCommandField.returnKeyType = .go
        terminalCommandField.backgroundColor = .white
        terminalCommandField.layer.cornerRadius = 8
        terminalCommandField.layer.borderWidth = 1
        terminalCommandField.layer.borderColor = UIColor(red: 0.83, green: 0.87, blue: 0.85, alpha: 1).cgColor
        terminalCommandField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        terminalCommandField.leftViewMode = .always
        terminalCommandField.heightAnchor.constraint(equalToConstant: 46).isActive = true
        inner.addArrangedSubview(formLabel("命令"))
        inner.addArrangedSubview(terminalCommandField)

        let actions = UIStackView()
        actions.axis = .horizontal
        actions.spacing = 8
        actions.distribution = .fillEqually
        actions.addArrangedSubview(primaryButton("执行") { [weak self] in self?.runTerminalCommand() })
        actions.addArrangedSubview(secondaryButton("复制输出") { [weak self] in self?.copyTerminalOutput() })
        actions.addArrangedSubview(secondaryButton("清空") { [weak self] in self?.clearTerminalOutput() })
        inner.addArrangedSubview(actions)

        terminalStandardOutput = UITextView()
        terminalErrorOutput = UITextView()
        inner.addArrangedSubview(terminalOutputBlock("标准输出", view: terminalStandardOutput, color: ink(), height: 170))
        inner.addArrangedSubview(terminalOutputBlock("错误输出", view: terminalErrorOutput, color: .systemRed, height: 100))
        stack.addArrangedSubview(card)
    }

    private func runTerminalCommand() {
        guard let session, session.can("termux_terminal") else {
            showDashboard()
            return
        }
        let command = (terminalCommandField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else {
            statusLabel.text = "请输入命令"
            return
        }
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        terminalCommandField.resignFirstResponder()
        terminalStandardOutput.text = "正在执行..."
        terminalErrorOutput.text = ""
        statusLabel.text = "命令执行中"
        postJSON(path: "/api/admin/termux/command", body: ["command": command, "timeoutMs": 15000], token: token, username: username) { [weak self] json in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let json else {
                    self.terminalStandardOutput.text = ""
                    self.terminalErrorOutput.text = "服务器未返回有效数据"
                    self.statusLabel.text = "命令执行失败"
                    return
                }
                self.terminalStandardOutput.text = (json["stdout"] as? String ?? "").trimmingCharacters(in: .newlines)
                self.terminalErrorOutput.text = (json["stderr"] as? String ?? json["error"] as? String ?? "").trimmingCharacters(in: .newlines)
                let exitCode = json["exitCode"] as? Int ?? json["code"] as? Int
                self.statusLabel.text = exitCode.map { "命令已结束，退出码 \($0)" } ?? "命令已结束"
            }
        }
    }

    private func copyTerminalOutput() {
        UIPasteboard.general.string = [
            "$ \(terminalCommandField.text ?? "")",
            "[标准输出]\n\(terminalStandardOutput.text ?? "")",
            "[错误输出]\n\(terminalErrorOutput.text ?? "")"
        ].joined(separator: "\n")
        statusLabel.text = "终端输出已复制"
    }

    private func clearTerminalOutput() {
        terminalStandardOutput.text = ""
        terminalErrorOutput.text = ""
        statusLabel.text = "输出已清空"
    }

    private func terminalOutputBlock(_ title: String, view: UITextView, color: UIColor, height: CGFloat) -> UIView {
        let block = UIStackView()
        block.axis = .vertical
        block.spacing = 6
        block.addArrangedSubview(formLabel(title))
        view.isEditable = false
        view.isSelectable = true
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.textColor = color
        view.backgroundColor = UIColor(red: 0.96, green: 0.97, blue: 0.97, alpha: 1)
        view.layer.cornerRadius = 8
        view.layer.borderWidth = 1
        view.layer.borderColor = UIColor(red: 0.86, green: 0.89, blue: 0.88, alpha: 1).cgColor
        view.heightAnchor.constraint(equalToConstant: height).isActive = true
        block.addArrangedSubview(view)
        return block
    }

    private func showTools() {
        showOperations()
    }

    private func showOperations() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(titleBlock("工作台", "系统、人员、审计与客户端"))
        buildBottomNavigation(selected: 3)
        let card = panel()
        let inner = VStack(card)
        inner.addArrangedSubview(sectionTitle("工具"))
        if session?.can("feedback_view") == true {
            inner.addArrangedSubview(toolButton("反馈中心", symbol: "text.bubble") { [weak self] in self?.showFeedback() })
        }
        if session?.can("user_insights") == true {
            inner.addArrangedSubview(toolButton("用户喜好", symbol: "chart.bar.xaxis") { [weak self] in self?.showInsights() })
        }
        if session?.can("termux_terminal") == true {
            inner.addArrangedSubview(toolButton("Termux 终端", symbol: "terminal") { [weak self] in self?.showTerminal() })
        }
        inner.addArrangedSubview(toolButton("权限明细", symbol: "key.horizontal") { [weak self] in self?.showPermissions() })
        inner.addArrangedSubview(toolButton("检查更新", symbol: "arrow.down.circle") { [weak self] in self?.checkUpdates(manual: true) })
        stack.addArrangedSubview(card)

        let summary = panel()
        let summaryStack = VStack(summary)
        let loading = small("正在读取工作台...")
        summaryStack.addArrangedSubview(loading)
        stack.addArrangedSubview(summary)
        fetchWorkspaceSummary { [weak self, weak summaryStack, weak loading] json in
            DispatchQueue.main.async {
                guard let self, let summaryStack else { return }
                loading?.removeFromSuperview()
                guard let json, (json["success"] as? Bool) == true else {
                    summaryStack.addArrangedSubview(self.small(json?["error"] as? String ?? "工作台暂时无法读取"))
                    summaryStack.addArrangedSubview(self.secondaryButton("重新加载") { [weak self] in self?.showOperations() })
                    return
                }
                self.renderWorkspaceSummary(json, into: summaryStack)
            }
        }
    }

    private func renderWorkspaceSummary(_ json: [String: Any], into stack: UIStackView) {
        renderNativeModules(json["modules"] as? [[String: Any]] ?? [], into: stack)
        if let system = json["system"] as? [String: Any] {
            stack.addArrangedSubview(sectionTitle("系统状态"))
            stack.addArrangedSubview(workspaceRow("在线与用户", "在线 \(system["online"] ?? 0) · 通行证 \(system["unifiedUsers"] ?? 0) · 管理员 \(system["admins"] ?? 0)"))
            stack.addArrangedSubview(workspaceRow("资源", "内存 \(system["memoryMB"] ?? 0) MB · 堆 \(system["heapMB"] ?? 0) MB · 运行 \((system["uptime"] as? Int ?? 0) / 3600) h"))
        }
        if let admins = json["admins"] as? [[String: Any]] {
            stack.addArrangedSubview(sectionTitle("管理员 · \(admins.count)"))
            if admins.isEmpty { stack.addArrangedSubview(small("暂无其他管理员")) }
            admins.prefix(8).forEach { item in
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
            if audit.isEmpty { stack.addArrangedSubview(small("暂无审计记录")) }
            audit.prefix(6).forEach { item in
                stack.addArrangedSubview(workspaceRow(
                    item["action"] as? String ?? "管理员操作",
                    "\(item["username"] as? String ?? "unknown") · \(item["result"] as? String ?? "success")\n\(item["timestamp"] as? String ?? "")"
                ))
            }
        }
        let apps = json["apps"] as? [[String: Any]] ?? []
        stack.addArrangedSubview(sectionTitle("客户端 · \(apps.count)"))
        if apps.isEmpty { stack.addArrangedSubview(small("暂无已发布客户端")) }
        apps.forEach { item in
            stack.addArrangedSubview(workspaceRow(
                item["platformLabel"] as? String ?? item["platform"] as? String ?? "客户端",
                "v\(item["version"] as? String ?? "-") · build \(item["build"] ?? 0) · \((item["available"] as? Bool) == true ? "可下载" : "文件缺失")"
            ))
        }
    }

    private func renderNativeModules(_ modules: [[String: Any]], into stack: UIStackView) {
        stack.addArrangedSubview(sectionTitle("全部功能 · \(modules.count)"))
        if modules.isEmpty {
            stack.addArrangedSubview(small("当前账号没有可用管理模块"))
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
        case "terminal": showTerminal()
        case "system", "security", "admins": showOperations()
        default: showNativeModuleWorkspace(module)
        }
    }

    private func showNativeModuleWorkspace(_ module: [String: Any]) {
        let title = module["label"] as? String ?? "管理模块"
        guard let endpoint = module["endpoint"] as? String, !endpoint.isEmpty,
              let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(titleBlock(title, module["group"] as? String ?? "管理"))
        stack.addArrangedSubview(secondaryButton("返回工作台") { [weak self] in self?.showOperations() })
        buildBottomNavigation(selected: 3)
        let card = panel()
        let inner = VStack(card)
        let loading = small("正在读取数据...")
        inner.addArrangedSubview(loading)
        stack.addArrangedSubview(card)
        getJSON(path: endpoint, token: token, username: username) { [weak self, weak inner, weak loading] json in
            DispatchQueue.main.async {
                guard let self, let inner else { return }
                loading?.removeFromSuperview()
                guard let json, (json["success"] as? Bool) == true else {
                    inner.addArrangedSubview(self.small(json?["error"] as? String ?? "模块数据读取失败"))
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
        let title = module["label"] as? String ?? "内容管理"
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(titleBlock(title, module["group"] as? String ?? "管理"))
        stack.addArrangedSubview(secondaryButton("返回工作台") { [weak self] in self?.showOperations() })
        buildBottomNavigation(selected: 3)
        let card = panel()
        let inner = VStack(card)
        inner.addArrangedSubview(small("正在读取记录..."))
        stack.addArrangedSubview(card)
        contentRequest(path: "/api/admin/manager/content/\(contentPath(moduleId))", body: nil, token: token, username: username) { [weak self, weak inner] result in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.handleContentUnauthorized(result) { return }
                guard self.isCurrentContentWorkspace(moduleId, generation: generation), let inner else { return }
                inner.arrangedSubviews.forEach { $0.removeFromSuperview() }
                if result.statusCode == 403 {
                    inner.addArrangedSubview(self.small(result.json?["error"] as? String ?? "当前账号没有此模块权限"))
                    return
                }
                guard result.statusCode == 200,
                      let workspace = result.json?["workspace"] as? [String: Any] else {
                    inner.addArrangedSubview(self.small(result.json?["error"] as? String ?? "模块数据读取失败"))
                    return
                }
                self.contentWorkspaces[moduleId] = workspace
                self.renderContentWorkspace(workspace, module: module, into: inner)
            }
        }
    }

    private func renderContentWorkspace(_ workspace: [String: Any], module: [String: Any], into inner: UIStackView) {
        let moduleId = module["id"] as? String ?? ""
        if (workspace["canCreate"] as? Bool) == true {
            inner.addArrangedSubview(primaryButton("新建记录") { [weak self] in
                self?.showContentEditor(module: module, workspace: workspace, record: nil, action: "create")
            })
        }
        let records = workspace["records"] as? [[String: Any]] ?? []
        if records.isEmpty {
            inner.addArrangedSubview(small("暂无记录"))
        }
        records.forEach { record in
            inner.addArrangedSubview(contentRecordView(record, workspace: workspace, module: module))
        }
        inner.addArrangedSubview(secondaryButton("刷新") { [weak self] in
            guard !moduleId.isEmpty else { return }
            self?.showContentWorkspace(module)
        })
    }

    private func contentRecordView(_ record: [String: Any], workspace: [String: Any], module: [String: Any]) -> UIView {
        let fields = record["fields"] as? [[String: Any]] ?? []
        let actions = record["actions"] as? [String] ?? []
        let title = record["title"] as? String ?? "未命名记录"
        let subtitle = record["subtitle"] as? String ?? record["group"] as? String ?? ""
        let row = UIStackView()
        row.axis = .vertical
        row.spacing = 6
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 10, left: 0, bottom: 10, right: 0)
        row.addArrangedSubview(label(title, 15, .semibold, ink()))
        if !subtitle.isEmpty { row.addArrangedSubview(small(subtitle)) }
        fields.filter { !($0["editable"] as? Bool ?? false) }.prefix(3).forEach { field in
            let fieldTitle = field["label"] as? String ?? field["key"] as? String ?? "字段"
            row.addArrangedSubview(small("\(fieldTitle)：\(contentText(field["value"]))"))
        }
        if actions.contains("update") {
            row.addArrangedSubview(secondaryButton("编辑") { [weak self] in
                self?.showContentEditor(module: module, workspace: workspace, record: record, action: "update")
            })
        }
        if actions.contains("delete") {
            row.addArrangedSubview(secondaryButton("删除") { [weak self] in
                self?.confirmContentDelete(module: module, record: record)
            })
        }
        return row
    }

    private func showContentEditor(module: [String: Any], workspace: [String: Any], record: [String: Any]?, action: String) {
        let fields = (record?["fields"] as? [[String: Any]]) ?? (workspace["createFields"] as? [[String: Any]]) ?? []
        let editor = UIViewController()
        editor.view.backgroundColor = bgColor()
        editor.title = action == "create" ? "新建记录" : "编辑记录"
        let scroll = UIScrollView()
        let form = UIStackView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        form.translatesAutoresizingMaskIntoConstraints = false
        form.axis = .vertical
        form.spacing = 12
        editor.view.addSubview(scroll)
        scroll.addSubview(form)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: editor.view.safeAreaLayoutGuide.topAnchor, constant: 16),
            scroll.leadingAnchor.constraint(equalTo: editor.view.leadingAnchor, constant: 18),
            scroll.trailingAnchor.constraint(equalTo: editor.view.trailingAnchor, constant: -18),
            scroll.bottomAnchor.constraint(equalTo: editor.view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            form.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            form.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor),
            form.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor),
            form.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor)
        ])
        var textFields: [String: UITextField] = [:]
        var textViews: [String: UITextView] = [:]
        var choiceValues: [String: String] = [:]
        fields.forEach { field in
            guard (field["editable"] as? Bool) == true,
                  let key = field["key"] as? String else { return }
            let fieldLabel = field["label"] as? String ?? key
            let initial = contentText(field["value"])
            form.addArrangedSubview(formLabel(fieldLabel))
            let type = field["type"] as? String ?? "text"
            if type == "multiline" {
                let input = UITextView()
                input.text = initial
                input.font = .systemFont(ofSize: 15)
                input.layer.borderWidth = 1
                input.layer.borderColor = UIColor.systemGray4.cgColor
                input.layer.cornerRadius = 8
                input.heightAnchor.constraint(equalToConstant: 112).isActive = true
                textViews[key] = input
                form.addArrangedSubview(input)
            } else if type == "choice" {
                choiceValues[key] = initial
                let options = field["options"] as? [[String: Any]] ?? []
                let choiceButton = UIButton(type: .system)
                choiceButton.contentHorizontalAlignment = .leading
                choiceButton.setTitle(initial.isEmpty ? "请选择" : initial, for: .normal)
                choiceButton.showsMenuAsPrimaryAction = true
                choiceButton.menu = UIMenu(children: options.map { option in
                    let value = contentText(option["value"])
                    let optionLabel = option["label"] as? String ?? value
                    return UIAction(title: optionLabel, state: value == initial ? .on : .off) { [weak choiceButton] _ in
                        choiceValues[key] = value
                        choiceButton?.setTitle(optionLabel, for: .normal)
                    }
                })
                choiceButton.isEnabled = !options.isEmpty
                form.addArrangedSubview(choiceButton)
            } else {
                let input = UITextField()
                input.borderStyle = .roundedRect
                input.text = initial
                input.keyboardType = type == "url" ? .URL : .default
                textFields[key] = input
                form.addArrangedSubview(input)
            }
        }
        let formStatus = small("")
        form.addArrangedSubview(formStatus)
        let saveButton = primaryButton(action == "create" ? "创建" : "保存") { }
        saveButton.addAction(UIAction { [weak self, weak editor, weak saveButton, weak formStatus] _ in
            guard let self, let saveButton else { return }
            var values = choiceValues
            textFields.forEach { values[$0.key] = $0.value.text ?? "" }
            textViews.forEach { values[$0.key] = $0.value.text }
            saveButton.isEnabled = false
            self.submitContentAction(
                moduleId: module["id"] as? String ?? "", action: action,
                recordId: record?["id"] as? String, revision: record?["revision"] as? String,
                values: values, confirmation: nil
            ) { [weak editor, weak saveButton, weak formStatus] success, message in
                formStatus?.text = message
                if success { editor?.dismiss(animated: true) }
                else { saveButton?.isEnabled = true }
            }
        }, for: .touchUpInside)
        form.addArrangedSubview(saveButton)
        editor.modalPresentationStyle = .pageSheet
        present(editor, animated: true)
    }

    private func confirmContentDelete(module: [String: Any], record: [String: Any]) {
        let recordId = record["id"] as? String ?? ""
        let title = record["title"] as? String ?? recordId
        guard !recordId.isEmpty else { return }
        let alert = UIAlertController(title: "删除 \(title)？", message: "此操作不可撤销。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "删除 \(title)", style: .destructive) { [weak self] _ in
            self?.submitContentAction(moduleId: module["id"] as? String ?? "", action: "delete", recordId: recordId,
                                      revision: record["revision"] as? String, values: [:], confirmation: recordId) { success, message in
                self?.statusLabel.text = success ? "已删除" : message
            }
        })
        present(alert, animated: true)
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
        request.setValue("ManagerPortal/iOS-\(appVersion)", forHTTPHeaderField: "X-Manager-Native")
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

    private func renderLegacyWorkspaceJSON(_ value: Any, into stack: UIStackView) {
        let output = UITextView()
        output.isEditable = false
        output.isSelectable = true
        output.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        output.textColor = ink()
        output.backgroundColor = .clear
        output.text = prettyJSON(value)
        output.heightAnchor.constraint(equalToConstant: 480).isActive = true
        stack.addArrangedSubview(output)
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

    private func workspaceRow(_ title: String, _ detail: String) -> UIView {
        let row = UIStackView()
        row.axis = .vertical
        row.spacing = 3
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        row.addArrangedSubview(label(title, 14, .semibold, ink()))
        row.addArrangedSubview(small(detail))
        return row
    }

    private func workspaceActionRow(_ title: String, _ detail: String, actionTitle: String, action: @escaping () -> Void) -> UIView {
        let row = UIStackView()
        row.axis = .vertical
        row.spacing = 6
        row.isLayoutMarginsRelativeArrangement = true
        row.layoutMargins = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        row.addArrangedSubview(label(title, 14, .semibold, ink()))
        row.addArrangedSubview(small(detail))
        row.addArrangedSubview(secondaryButton(actionTitle, action))
        return row
    }

    private func updateAdminStatus(username: String, status: String) {
        guard session?.can("admin_manage") == true,
              let token = UserDefaults.standard.string(forKey: "managerToken"),
              let actor = UserDefaults.standard.string(forKey: "managerUsername") else { return }
        statusLabel.text = status == "active" ? "正在启用管理员..." : "正在停用管理员..."
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
                    self.statusLabel.text = status == "active" ? "管理员已启用" : "管理员已停用"
                    self.showOperations()
                } else {
                    self.statusLabel.text = json?["error"] as? String ?? "管理员状态更新失败"
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
        ["super": "总管理员", "admin": "管理员", "operator": "运维", "editor": "编辑"][role] ?? role
    }

    private func showAccount() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        stack.addArrangedSubview(titleBlock("账户", session?.username ?? "未登录"))
        buildBottomNavigation(selected: 4)
        let card = panel()
        let inner = VStack(card)
        inner.addArrangedSubview(statRow("当前版本", appVersion))
        inner.addArrangedSubview(statRow("可用权限", session?.isSuper == true ? "全部" : "\(session?.permissions.count ?? 0)"))
        inner.addArrangedSubview(secondaryButton("退出登录") { [weak self] in self?.logout() })
        stack.addArrangedSubview(card)
    }

    private func fetchNotices(completion: @escaping ([Notice]) -> Void) {
        URLSession.shared.dataTask(with: notificationFeedURL) { data, _, _ in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let items = json["items"] as? [[String: Any]] else {
                completion([])
                return
            }
            completion(items.map {
                Notice(
                    id: $0["id"] as? String ?? UUID().uuidString,
                    title: $0["title"] as? String ?? "通知",
                    body: $0["body"] as? String ?? "",
                    level: $0["level"] as? String ?? "info"
                )
            })
        }.resume()
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
            statusLabel.text = "请先登录"
            return
        }
        postJSON(path: "/api/admin/user-insights/settings", body: ["enabled": true, "intervalMinutes": minutes], token: token, username: username) { [weak self] json in
            DispatchQueue.main.async {
                self?.statusLabel.text = (json?["success"] as? Bool) == true ? "提醒已保存" : "保存失败"
            }
        }
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
        DispatchQueue.main.async { self.statusLabel.text = "\(self.levelLabel(notice.level))：\(notice.title)" }
        let content = UNMutableNotificationContent()
        content.title = "\(levelLabel(notice.level))：\(notice.title)"
        content.body = notice.body
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: notice.id, content: content, trigger: nil))
    }

    private func checkUpdates(manual: Bool) {
        fetchAvailableUpdate { [weak self] update in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let update else {
                    if manual { self.statusLabel.text = "已是最新版本" }
                    return
                }
                self.statusLabel.text = "发现新版本"
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
        let alert = UIAlertController(
            title: "发现新版本",
            message: "铮铮控制台 \(update.version) 已发布。将打开站内安装文件；iOS 需要有效签名才能交给系统安装。",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "下载更新", style: .default) { _ in self.openInstallEntry(update) })
        alert.addAction(UIAlertAction(title: "稍后", style: .cancel))
        if presentedViewController == nil {
            present(alert, animated: true)
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
                build: remoteBuild
            ))
        }
    }

    private func notifyUpdate(_ update: AppUpdate) {
        let key = "managerLastUpdateNoticeBuild"
        if UserDefaults.standard.integer(forKey: key) == update.build { return }
        UserDefaults.standard.set(update.build, forKey: key)
        let content = UNMutableNotificationContent()
        content.title = "铮铮控制台有新版本"
        content.body = "v\(update.version) 可用，点更新可打开站内安装入口。"
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "manager-update-\(update.build)", content: content, trigger: nil))
    }

    private func openInstallEntry(_ update: AppUpdate) {
        guard let token = UserDefaults.standard.string(forKey: "managerToken"),
              let username = UserDefaults.standard.string(forKey: "managerUsername") else {
            statusLabel.text = "请先登录"
            return
        }
        let tokenPath = "/api/admin/manager/apps/download-token?file=\(update.fileName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? update.fileName)"
        getJSON(path: tokenPath, token: token, username: username) { [weak self] json in
            DispatchQueue.main.async {
                guard let downloadPath = json?["downloadURL"] as? String,
                      let url = URL(string: downloadPath.hasPrefix("http") ? downloadPath : siteRoot + downloadPath) else {
                    self?.statusLabel.text = "生成下载票据失败"
                    return
                }
                UIApplication.shared.open(url)
            }
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
        req.setValue("ManagerPortal/iOS-\(appVersion)", forHTTPHeaderField: "X-Manager-Native")
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

    private func VStack(_ card: UIView) -> UIStackView {
        let inner = UIStackView()
        inner.axis = .vertical
        inner.spacing = 12
        inner.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(inner)
        NSLayoutConstraint.activate([
            inner.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            inner.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            inner.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            inner.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18)
        ])
        return inner
    }

    private func titleBlock(_ title: String, _ subtitle: String) -> UIView {
        let box = UIStackView()
        box.axis = .vertical
        box.spacing = 3
        box.addArrangedSubview(label(title, 30, .bold, ink()))
        box.addArrangedSubview(label(subtitle, 13, .medium, muted()))
        return box
    }

    private func panel() -> UIView {
        let view = UIView()
        view.backgroundColor = .white
        view.layer.cornerRadius = 12
        view.layer.borderWidth = 1
        view.layer.borderColor = UIColor(red: 0.86, green: 0.89, blue: 0.91, alpha: 1).cgColor
        return view
    }

    private func statRow(_ title: String, _ value: String) -> UIView {
        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .center
        row.addArrangedSubview(label(title, 14, .medium, muted()))
        row.addArrangedSubview(flex())
        row.addArrangedSubview(label(value, 18, .bold, green()))
        return row
    }

    private func noticeRow(_ notice: Notice) -> UIView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 10
        row.alignment = .center
        row.addArrangedSubview(dot(notice.level))
        let text = UIStackView()
        text.axis = .vertical
        text.spacing = 2
        text.addArrangedSubview(label(notice.title, 14, .semibold, ink()))
        text.addArrangedSubview(label(notice.body, 12, .regular, muted()))
        row.addArrangedSubview(text)
        return row
    }

    private func label(_ text: String, _ size: CGFloat, _ weight: UIFont.Weight, _ color: UIColor) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = color
        label.numberOfLines = 0
        return label
    }

    private func formLabel(_ text: String) -> UILabel { label(text, 12, .semibold, muted()) }
    private func sectionTitle(_ text: String) -> UILabel { label(text, 18, .bold, ink()) }
    private func small(_ text: String) -> UILabel { label(text, 13, .regular, muted()) }

    private func mono(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        label.textColor = ink()
        label.numberOfLines = 0
        return label
    }

    private func primaryButton(_ text: String, _ action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(text, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        button.tintColor = .white
        button.backgroundColor = green()
        button.layer.cornerRadius = 8
        button.heightAnchor.constraint(equalToConstant: 46).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func secondaryButton(_ text: String, _ action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(text, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        button.tintColor = ink()
        button.backgroundColor = .white
        button.layer.cornerRadius = 8
        button.layer.borderColor = UIColor(red: 0.86, green: 0.89, blue: 0.91, alpha: 1).cgColor
        button.layer.borderWidth = 1
        button.heightAnchor.constraint(equalToConstant: 40).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func toolButton(_ text: String, symbol: String, _ action: @escaping () -> Void) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.title = text
        configuration.image = UIImage(systemName: symbol)
        configuration.imagePadding = 12
        configuration.imagePlacement = .leading
        configuration.baseForegroundColor = ink()
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 4, bottom: 12, trailing: 4)
        let button = UIButton(configuration: configuration)
        button.contentHorizontalAlignment = .leading
        button.layer.borderColor = UIColor(red: 0.88, green: 0.90, blue: 0.91, alpha: 1).cgColor
        button.layer.borderWidth = 0.5
        button.layer.cornerRadius = 8
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func dot(_ level: String) -> UIView {
        let view = UIView()
        view.backgroundColor = level == "critical" ? .systemRed : level == "warning" ? .systemOrange : green()
        view.layer.cornerRadius = 5
        view.widthAnchor.constraint(equalToConstant: 10).isActive = true
        view.heightAnchor.constraint(equalToConstant: 10).isActive = true
        return view
    }

    private func flex() -> UIView {
        let view = UIView()
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return view
    }

    private func permissionLabel(_ id: String) -> String {
        let names = [
            "*": "全部权限", "system_check": "系统检查", "logs_view": "日志查看",
            "admin_manage": "管理员", "security_manage": "安全", "alerts_manage": "通知",
            "termux_terminal": "终端", "code_edit": "源码", "app_manage": "应用",
            "user_insights": "喜好", "feedback_view": "反馈查看",
            "feedback_manage": "反馈处理", "feedback_delete": "反馈回收站",
            "feedback_purge": "反馈永久删除"
        ]
        return names[id] ?? id
    }

    private func levelLabel(_ level: String) -> String {
        if level == "critical" { return "重大" }
        if level == "warning" { return "提醒" }
        return "信息"
    }

    private func bgColor() -> UIColor { UIColor(red: 0.953, green: 0.961, blue: 0.965, alpha: 1) }
    private func ink() -> UIColor { UIColor(red: 0.10, green: 0.13, blue: 0.16, alpha: 1) }
    private func muted() -> UIColor { UIColor(red: 0.39, green: 0.44, blue: 0.49, alpha: 1) }
    private func green() -> UIColor { UIColor(red: 0.137, green: 0.42, blue: 0.314, alpha: 1) }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
