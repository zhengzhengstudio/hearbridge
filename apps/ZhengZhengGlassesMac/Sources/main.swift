import Cocoa
import Foundation

private let appVersion = "0.1.5"
private let appBuild = 6
private let appUpdateId = "zhengzheng-glasses-macos"
private let manifestURL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!
private let apiRoot = URL(string: "https://zhengzhengstudio.cn/api")!

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var accountLabel = NSTextField(labelWithString: "未登录")
    private var detailLabel = NSTextField(labelWithString: "可以先创建临时配镜用户，或登录铮铮通行证同步数据。")
    private var updateLabel = NSTextField(labelWithString: "正在读取下载中心版本...")
    private var sleeves: [ClosureSleeve] = []
    private var currentUser: [String: Any]?
    private var contentHost = NSView()
    private var activeSection = "home"
    private var navigationButtons: [String: NSButton] = [:]
    private var fittingStep = 1
    private var faceWidth = "139"
    private var pd = "63"
    private var bridgeWidth = "18"
    private var rightDegree = ""
    private var leftDegree = ""
    private var selectedFrame = "雾银圆框"
    private var templeLength = "145"
    private var customizationNote = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        loadSession()
        buildWindow()
        checkUpdates(showAlert: false)
        loadShopCatalog { [weak self] frames in
            self?.shopFrames = frames
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "铮铮眼镜"
        window.minSize = NSSize(width: 880, height: 620)
        window.center()

        let shell = NSStackView()
        shell.orientation = .horizontal
        shell.spacing = 0
        shell.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = shell
        shell.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor).isActive = true
        shell.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor).isActive = true
        shell.topAnchor.constraint(equalTo: window.contentView!.topAnchor).isActive = true
        shell.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor).isActive = true

        let navigation = sidebar()
        navigation.widthAnchor.constraint(equalToConstant: 224).isActive = true
        shell.addArrangedSubview(navigation)
        contentHost.wantsLayer = true
        contentHost.layer?.backgroundColor = NSColor(calibratedRed: 0.94, green: 0.97, blue: 0.96, alpha: 1).cgColor
        shell.addArrangedSubview(contentHost)
        renderSection("home")
        window.makeKeyAndOrderFront(nil)
    }

    private func sidebar() -> NSView {
        let box = NSView()
        box.wantsLayer = true
        box.layer?.backgroundColor = NSColor.white.cgColor
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        stack.addArrangedSubview(title("铮铮眼镜", size: 21))
        stack.addArrangedSubview(copy("配镜工作台"))
        stack.setCustomSpacing(22, after: stack.arrangedSubviews.last!)
        [("首页", "home"), ("镜框库", "shop"), ("配镜", "fit"), ("心愿单", "wish"), ("聊天", "chat"), ("我的档案", "profile"), ("商家中心", "merchant")].forEach { item in
            let control = sidebarButton(item.0, key: item.1)
            control.widthAnchor.constraint(equalToConstant: 188).isActive = true
            stack.addArrangedSubview(control)
        }
        let spacer = NSView()
        stack.addArrangedSubview(spacer)
        spacer.heightAnchor.constraint(greaterThanOrEqualToConstant: 20).isActive = true
        stack.addArrangedSubview(copy("与网页版共用账号、档案、心愿单和会话"))
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -18)
        ])
        return box
    }

    private func sidebarButton(_ text: String, key: String) -> NSButton {
        let control = button(text, primary: activeSection == key) { [weak self] in self?.renderSection(key) }
        control.alignment = .left
        control.heightAnchor.constraint(equalToConstant: 40).isActive = true
        navigationButtons[key] = control
        return control
    }

    private func renderSection(_ key: String) {
        activeSection = key
        navigationButtons.forEach { item in
            let selected = item.key == key
            item.value.wantsLayer = true
            item.value.layer?.backgroundColor = selected ? NSColor(calibratedRed: 0.05, green: 0.49, blue: 0.43, alpha: 1).cgColor : NSColor.clear.cgColor
            item.value.contentTintColor = selected ? .white : NSColor(calibratedRed: 0.05, green: 0.43, blue: 0.38, alpha: 1)
        }
        contentHost.subviews.forEach { $0.removeFromSuperview() }
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let root = sectionContent(key)
        root.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = root
        contentHost.addSubview(scroll)
        pin(scroll, to: contentHost, inset: 0)
        root.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor).isActive = true
    }

    // ===== 电商风 · 镜框库（2026-10-23）=====

    private struct ShopFrame {
        let id: String
        let name: String
        let merchant: String
        let price: String
        let spec: String
        let imageURL: String
    }

    private var shopFrames: [ShopFrame] = []
    private var shopFilter = "all"
    private let shopAssetBase = URL(string: "https://glasses.zhengzhengstudio.cn/")!

    private func loadShopCatalog(completion: @escaping ([ShopFrame]) -> Void) {
        var request = URLRequest(url: apiRoot.appendingPathComponent("glasses/catalog"))
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        URLSession.shared.dataTask(with: request) { data, _, _ in
            var frames: [ShopFrame] = []
            if let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let list = json["frames"] as? [[String: Any]] {
                frames = list.compactMap { item in
                    let id = String(item["id"] as? String ?? "")
                    guard !id.isEmpty else { return nil }
                    let name = String(item["name"] as? String ?? "未命名镜框")
                    let merchant = String(item["merchantName"] as? String ?? "铮铮精选")
                    let priceValue = (item["price"] as? NSNumber)?.doubleValue ?? 0
                    let lens = (item["lensWidth"] as? NSNumber)?.intValue ?? 0
                    let bridge = (item["bridgeSize"] as? NSNumber)?.intValue ?? 0
                    var spec = lens > 0 ? "镜圈 \(lens)mm" : String(item["type"] as? String ?? "镜框")
                    if lens > 0 && bridge > 0 { spec += " · 鼻梁 \(bridge)mm" }
                    let raw = String(item["tryOnImage"] as? String ?? item["image"] as? String ?? "")
                    var imageURL = ""
                    if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
                        imageURL = raw
                    } else if raw.hasPrefix("/") {
                        imageURL = "https://glasses.zhengzhengstudio.cn" + raw
                    } else if !raw.isEmpty {
                        imageURL = self.shopAssetBase.absoluteString + raw
                    }
                    return ShopFrame(id: id, name: name, merchant: merchant,
                                     price: priceValue > 0 ? "¥\(Int(priceValue))" : "价格待询",
                                     spec: spec, imageURL: imageURL)
                }
            }
            DispatchQueue.main.async { completion(frames) }
        }.resume()
    }

    private func shopMatchedFrames() -> [ShopFrame] {
        guard shopFilter != "all" else { return shopFrames }
        return shopFrames.filter { frame in
            let haystack = "\(frame.merchant) \(frame.id)".lowercased()
            switch shopFilter {
            case "molsion": return haystack.contains("陌森") || haystack.contains("molsion")
            case "shanshan": return haystack.contains("珊珊") || haystack.contains("shanshan")
            case "kimi": return haystack.contains("kimi")
            default: return true
            }
        }
    }

    /// 电商风要混排：陌森 / 珊珊 / Kimi 轮流出场，避免整屏同一品牌。
    private func shopInterleaved(_ frames: [ShopFrame]) -> [ShopFrame] {
        var buckets: [String: [ShopFrame]] = ["molsion": [], "shanshan": [], "other": []]
        for frame in frames {
            let haystack = "\(frame.merchant) \(frame.id)".lowercased()
            if haystack.contains("陌森") || haystack.contains("molsion") {
                buckets["molsion"]?.append(frame)
            } else if haystack.contains("珊珊") || haystack.contains("shanshan") {
                buckets["shanshan"]?.append(frame)
            } else {
                buckets["other"]?.append(frame)
            }
        }
        var out: [ShopFrame] = []
        var index = 0
        while out.count < frames.count {
            for key in ["molsion", "shanshan", "other"] {
                if var bucket = buckets[key], !bucket.isEmpty {
                    let head = bucket.removeFirst()
                    buckets[key] = bucket
                    out.append(head)
                }
            }
            index += 1
            if index > frames.count + 4 { break }
        }
        return out
    }

    private func buildShopCatalog(in root: NSStackView) {
        root.addArrangedSubview(pageHeading("镜框库", "陌森、珊珊与精选款式都在这里，挑中之后直接进实时试戴。"))

        let filterRow = NSStackView()
        filterRow.orientation = .horizontal
        filterRow.spacing = 8
        for item in [("all", "全部"), ("molsion", "陌森"), ("shanshan", "珊珊"), ("kimi", "Kimi")] {
            let chip = button(item.1, primary: shopFilter == item.0) { [weak self] in
                self?.shopFilter = item.0
                self?.renderSection("shop")
            }
            filterRow.addArrangedSubview(chip)
        }
        root.addArrangedSubview(filterRow)

        let status = copy(shopFrames.isEmpty ? "正在加载镜框库…" : "镜框库共 \(shopFrames.count) 款在售")
        root.addArrangedSubview(status)

        let grid = NSStackView()
        grid.orientation = .vertical
        grid.spacing = 14
        grid.alignment = .leading
        root.addArrangedSubview(grid)

        let frames = shopInterleaved(shopMatchedFrames()).prefix(12)
        if frames.isEmpty {
            let empty = card()
            let emptyStack = NSStackView()
            emptyStack.orientation = .vertical
            emptyStack.spacing = 8
            emptyStack.addArrangedSubview(copy(shopFrames.isEmpty ? "镜框库暂时没有加载出来，稍后再试。" : "这个分类暂时没有镜框，换一个试试。"))
            emptyStack.addArrangedSubview(button("重新加载") { [weak self] in self?.loadShopCatalog { frames in
                self?.shopFrames = frames
                self?.renderSection("shop")
            } })
            empty.addSubview(emptyStack)
            emptyStack.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                emptyStack.leadingAnchor.constraint(equalTo: empty.leadingAnchor, constant: 18),
                emptyStack.trailingAnchor.constraint(equalTo: empty.trailingAnchor, constant: -18),
                emptyStack.topAnchor.constraint(equalTo: empty.topAnchor, constant: 18),
                emptyStack.bottomAnchor.constraint(equalTo: empty.bottomAnchor, constant: -18)
            ])
            grid.addArrangedSubview(empty)
            return
        }

        let columns = 3
        var row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 14
        for (offset, frame) in frames.enumerated() {
            if offset > 0 && offset % columns == 0 {
                grid.addArrangedSubview(row)
                row = NSStackView()
                row.orientation = .horizontal
                row.spacing = 14
            }
            row.addArrangedSubview(shopFrameCard(frame))
        }
        if row.arrangedSubviews.count > 0 { grid.addArrangedSubview(row) }
    }

    private func shopFrameCard(_ frame: ShopFrame) -> NSView {
        let box = card()
        box.translatesAutoresizingMaskIntoConstraints = false
        box.widthAnchor.constraint(greaterThanOrEqualToConstant: 210).isActive = true

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 6
        stack.alignment = .leading
        stack.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)

        let imageView = NSImageView()
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.wantsLayer = true
        imageView.layer?.backgroundColor = NSColor(calibratedRed: 0.95, green: 0.97, blue: 0.97, alpha: 1).cgColor
        imageView.layer?.cornerRadius = 10
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.heightAnchor.constraint(equalToConstant: 120).isActive = true
        imageView.widthAnchor.constraint(equalToConstant: 180).isActive = true
        if let url = URL(string: frame.imageURL), !frame.imageURL.isEmpty {
            URLSession.shared.dataTask(with: url) { data, _, _ in
                guard let data, let image = NSImage(data: data) else { return }
                DispatchQueue.main.async { imageView.image = image }
            }.resume()
        }
        stack.addArrangedSubview(imageView)

        let brand = NSTextField(labelWithString: frame.merchant)
        brand.font = .boldSystemFont(ofSize: 11)
        brand.textColor = NSColor(calibratedRed: 0.05, green: 0.49, blue: 0.43, alpha: 1)
        stack.addArrangedSubview(brand)

        let name = NSTextField(labelWithString: frame.name)
        name.font = .systemFont(ofSize: 13)
        name.textColor = ink()
        name.lineBreakMode = .byTruncatingTail
        name.maximumNumberOfLines = 2
        stack.addArrangedSubview(name)

        let spec = NSTextField(labelWithString: frame.spec)
        spec.font = .systemFont(ofSize: 11)
        spec.textColor = muted()
        stack.addArrangedSubview(spec)

        let price = NSTextField(labelWithString: frame.price)
        price.font = .boldSystemFont(ofSize: 16)
        price.textColor = NSColor(calibratedRed: 0.90, green: 0.44, blue: 0.32, alpha: 1)
        stack.addArrangedSubview(price)

        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 8
        let tryOn = button("试戴", primary: true) { [weak self] in
            self?.selectedFrame = frame.name
            self?.renderSection("fit")
        }
        let favorite = button("收藏") { [weak self] in
            self?.selectedFrame = frame.name
            self?.showMessage("已选中 \(frame.name)，到心愿单里可以发给商家。")
        }
        actions.addArrangedSubview(tryOn)
        actions.addArrangedSubview(favorite)
        stack.addArrangedSubview(actions)

        box.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: box.trailingAnchor),
            stack.topAnchor.constraint(equalTo: box.topAnchor),
            stack.bottomAnchor.constraint(equalTo: box.bottomAnchor)
        ])
        return box
    }

    private func sectionContent(_ key: String) -> NSStackView {
        let root = NSStackView()
        root.orientation = .vertical
        root.spacing = 16
        root.edgeInsets = NSEdgeInsets(top: 30, left: 34, bottom: 34, right: 34)
        switch key {
        case "shop": buildShopCatalog(in: root)
        case "fit": buildFitWorkspace(in: root)
        case "wish": buildSimpleWorkspace(in: root, titleText: "心愿单", subtitle: "网页版和 App 收藏的镜框会汇总在这里，再按商家发送。", actions: [("继续选镜框", "fit"), ("发送给商家", "chat")])
        case "chat": buildChatWorkspace(in: root)
        case "profile":
            root.addArrangedSubview(pageHeading("我的档案", "查看账号、最近一次配镜记录和跨设备同步状态。"))
            root.addArrangedSubview(accountCard())
            root.addArrangedSubview(infoStrip())
        case "merchant": buildSimpleWorkspace(in: root, titleText: "商家中心", subtitle: "入驻、上传镜框原图与试戴图、处理心愿单和定制沟通。顾客功能不会混在这里。", actions: [("注册或编辑商家", "profile"), ("进入商家沟通", "chat")])
        default: buildDashboard(in: root)
        }
        return root
    }

    private func pageHeading(_ name: String, _ subtitle: String) -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 5
        stack.addArrangedSubview(title(name, size: 29))
        stack.addArrangedSubview(copy(subtitle))
        return stack
    }

    private func buildDashboard(in root: NSStackView) {
        root.addArrangedSubview(pageHeading("欢迎回来", "继续配镜，或先逛逛镜框库里的真实在售款式。"))

        // 电商风指标条
        let stats = NSStackView()
        stats.orientation = .horizontal
        stats.spacing = 28
        let statItems = [(shopFrames.count > 0 ? "\(shopFrames.count)" : "318", "在售镜框"), ("2", "合作品牌"), ("≈1 分钟", "完成一次试戴")]
        for item in statItems {
            let column = NSStackView()
            column.orientation = .vertical
            column.spacing = 3
            let value = NSTextField(labelWithString: item.0)
            value.font = .boldSystemFont(ofSize: 26)
            value.textColor = NSColor(calibratedRed: 0.07, green: 0.37, blue: 0.35, alpha: 1)
            let caption = NSTextField(labelWithString: item.1)
            caption.font = .systemFont(ofSize: 12)
            caption.textColor = muted()
            column.addArrangedSubview(value)
            column.addArrangedSubview(caption)
            stats.addArrangedSubview(column)
        }
        root.addArrangedSubview(stats)

        let resume = card()
        let content = NSStackView()
        content.orientation = .vertical
        content.spacing = 12
        content.translatesAutoresizingMaskIntoConstraints = false
        resume.addSubview(content)
        content.addArrangedSubview(title("开始一次完整配镜", size: 22))
        content.addArrangedSubview(copy("采集、试戴、心愿单、报告和商家沟通会使用同一个账号与记录。"))
        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 10
        actions.addArrangedSubview(button("逛镜框库", primary: true) { [weak self] in self?.renderSection("shop") })
        actions.addArrangedSubview(button("继续配镜") { [weak self] in self?.renderSection("fit") })
        actions.addArrangedSubview(button("打开聊天") { [weak self] in self?.renderSection("chat") })
        content.addArrangedSubview(actions)
        pin(content, to: resume, inset: 20)
        root.addArrangedSubview(resume)
        root.addArrangedSubview(accountCard())
        root.addArrangedSubview(syncCard())
    }

    private func syncCard() -> NSView {
        let box = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        stack.addArrangedSubview(title("跨设备接力", size: 18))
        stack.addArrangedSubview(copy(currentUser == nil ? "当前数据先保存在这台 Mac。登录后可与 glasses.zhengzhengstudio.cn 共享档案、心愿单和会话。" : "已连接铮铮通行证，网页版与 App 使用同一份用户数据。"))
        pin(stack, to: box, inset: 18)
        return box
    }

    private func buildFitWorkspace(in root: NSStackView) {
        buildFitStep(in: root)
    }

    private func buildFitStep(in root: NSStackView) {
        let titles = [
            "第 1 步 · 身份与临时用户",
            "第 2 步 · 多角度采集",
            "第 3 步 · 摄像头试戴",
            "第 4 步 · 报告与导出",
            "第 5 步 · 定制镜框"
        ]
        let descriptions = [
            "确认这次配镜记录属于谁。正式账号可跨设备同步，临时用户只保存在这台 Mac。",
            "查看或校准脸宽、瞳距和鼻梁宽。摄像头关键帧可在移动端采集后同步到这里。",
            "选择当前镜框并整理心愿。实时人脸试戴需在支持摄像头识别的移动端完成。",
            "查看尺寸报告，并选填医院或视光机构提供的验光信息。",
            "确认镜圈、鼻梁、镜腿与定制说明，保存后完成本次流程。"
        ]
        root.addArrangedSubview(pageHeading(titles[fittingStep - 1], descriptions[fittingStep - 1]))
        let progress = NSProgressIndicator()
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 5
        progress.doubleValue = Double(fittingStep)
        root.addArrangedSubview(progress)

        let box = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        var saveStep: () -> Void = { [weak self] in self?.persistFittingState() }

        switch fittingStep {
        case 1:
            stack.addArrangedSubview(title(currentUser == nil ? "尚未选择身份" : "当前用户", size: 20))
            stack.addArrangedSubview(accountLabel)
            stack.addArrangedSubview(detailLabel)
            let actions = NSStackView()
            actions.orientation = .horizontal
            actions.spacing = 10
            actions.addArrangedSubview(button("登录通行证", primary: true) { [weak self] in self?.showLogin() })
            actions.addArrangedSubview(button("注册账号") { [weak self] in self?.showRegister() })
            actions.addArrangedSubview(button("临时配镜用户") { [weak self] in self?.showTemporaryUser() })
            stack.addArrangedSubview(actions)
        case 2:
            stack.addArrangedSubview(title("尺寸校准", size: 20))
            stack.addArrangedSubview(copy("毫米尺寸必须以真实瞳距、脸宽或鼻梁宽校准；本步骤不填写验光单。"))
            let fields = form([("脸宽 mm", false), ("瞳距 PD mm", false), ("鼻梁宽 mm", false)])
            fields.inputs[0].stringValue = faceWidth
            fields.inputs[1].stringValue = pd
            fields.inputs[2].stringValue = bridgeWidth
            stack.addArrangedSubview(fields.views)
            stack.addArrangedSubview(copy("多角度采集请在 Android 或 HarmonyOS 手机端完成；同步后可继续在 Mac 整理报告。"))
            saveStep = { [weak self, weak a = fields.inputs[0], weak b = fields.inputs[1], weak c = fields.inputs[2]] in
                guard let self else { return }
                self.faceWidth = a?.stringValue ?? self.faceWidth
                self.pd = b?.stringValue ?? self.pd
                self.bridgeWidth = c?.stringValue ?? self.bridgeWidth
                self.persistFittingState()
            }
        case 3:
            stack.addArrangedSubview(title("当前试戴：\(selectedFrame)", size: 20))
            stack.addArrangedSubview(copy("这里只选择镜框和心愿；报告与验光信息会留在下一步。"))
            let picker = NSPopUpButton()
            picker.addItems(withTitles: ["雾银圆框", "静黑矩形框", "琥珀猫眼框", "透明方框"])
            picker.selectItem(withTitle: selectedFrame)
            stack.addArrangedSubview(picker)
            stack.addArrangedSubview(button("加入心愿单") { [weak self, weak picker] in
                guard let self else { return }
                self.selectedFrame = picker?.titleOfSelectedItem ?? self.selectedFrame
                self.persistFittingState()
                self.showMessage("已将 \(self.selectedFrame) 加入本机心愿。")
            })
            saveStep = { [weak self, weak picker] in
                guard let self else { return }
                self.selectedFrame = picker?.titleOfSelectedItem ?? self.selectedFrame
                self.persistFittingState()
            }
        case 4:
            stack.addArrangedSubview(title("选填验光信息", size: 20))
            let fields = form([("右眼度数，可选", false), ("左眼度数，可选", false)])
            fields.inputs[0].stringValue = rightDegree
            fields.inputs[1].stringValue = leftDegree
            stack.addArrangedSubview(fields.views)
            stack.addArrangedSubview(copy(fittingReport()))
            stack.addArrangedSubview(button("复制报告") { [weak self] in
                guard let self else { return }
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(self.fittingReport(), forType: .string)
                self.showMessage("报告已复制。")
            })
            saveStep = { [weak self, weak a = fields.inputs[0], weak b = fields.inputs[1]] in
                guard let self else { return }
                self.rightDegree = a?.stringValue ?? ""
                self.leftDegree = b?.stringValue ?? ""
                self.persistFittingState()
            }
        default:
            stack.addArrangedSubview(title("定制参数", size: 20))
            let fields = form([("建议镜圈宽度 mm", false), ("鼻梁宽 mm", false), ("镜腿长度 mm", false), ("材料、颜色、鼻托或其他说明", false)])
            fields.inputs[0].stringValue = recommendedLensWidth()
            fields.inputs[1].stringValue = bridgeWidth
            fields.inputs[2].stringValue = templeLength
            fields.inputs[3].stringValue = customizationNote
            stack.addArrangedSubview(fields.views)
            stack.addArrangedSubview(button("联系配镜顾问") { [weak self] in self?.renderSection("chat") })
            saveStep = { [weak self, weak bridge = fields.inputs[1], weak temple = fields.inputs[2], weak note = fields.inputs[3]] in
                guard let self else { return }
                self.bridgeWidth = bridge?.stringValue ?? self.bridgeWidth
                self.templeLength = temple?.stringValue ?? self.templeLength
                self.customizationNote = note?.stringValue ?? ""
                self.persistFittingState()
            }
        }
        pin(stack, to: box, inset: 20)
        root.addArrangedSubview(box)
        fitNavigation(in: root, save: saveStep)
    }

    private func fitNavigation(in root: NSStackView, save: @escaping () -> Void) {
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.addArrangedSubview(button(fittingStep == 1 ? "返回首页" : "上一步") { [weak self] in
            guard let self else { return }
            if self.fittingStep == 1 { self.renderSection("home") }
            else {
                self.fittingStep -= 1
                self.persistFittingState()
                self.renderSection("fit")
            }
        })
        row.addArrangedSubview(button(fittingStep == 5 ? "完成配镜" : "保存并下一步", primary: true) { [weak self] in
            guard let self else { return }
            save()
            if self.fittingStep == 5 {
                self.fittingStep = 1
                self.persistFittingState()
                self.renderSection("profile")
            } else {
                self.fittingStep += 1
                self.persistFittingState()
                self.renderSection("fit")
            }
        })
        root.addArrangedSubview(row)
    }

    private func recommendedLensWidth() -> String {
        let value = Int(pd) ?? 63
        return value <= 60 ? "49" : (value <= 63 ? "51" : "54")
    }

    private func fittingReport() -> String {
        "用户：\((currentUser?["nickname"] as? String) ?? (currentUser?["username"] as? String) ?? "匿名用户")\n脸宽：\(faceWidth) mm\n瞳距：\(pd) mm\n建议镜圈宽度：\(recommendedLensWidth()) mm\n鼻梁宽：\(bridgeWidth) mm\n当前镜框：\(selectedFrame)\n右眼：\(rightDegree.isEmpty ? "未填" : rightDegree)\n左眼：\(leftDegree.isEmpty ? "未填" : leftDegree)"
    }

    private func persistFittingState() {
        UserDefaults.standard.set(fittingStep, forKey: "zz_glasses_fitting_step")
        UserDefaults.standard.set(faceWidth, forKey: "zz_glasses_face_width")
        UserDefaults.standard.set(pd, forKey: "zz_glasses_pd")
        UserDefaults.standard.set(bridgeWidth, forKey: "zz_glasses_bridge")
        UserDefaults.standard.set(rightDegree, forKey: "zz_glasses_right_degree")
        UserDefaults.standard.set(leftDegree, forKey: "zz_glasses_left_degree")
        UserDefaults.standard.set(selectedFrame, forKey: "zz_glasses_selected_frame")
        UserDefaults.standard.set(templeLength, forKey: "zz_glasses_temple")
        UserDefaults.standard.set(customizationNote, forKey: "zz_glasses_custom_note")
    }

    private func buildSimpleWorkspace(in root: NSStackView, titleText: String, subtitle: String, actions: [(String, String)]) {
        root.addArrangedSubview(pageHeading(titleText, subtitle))
        let empty = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        empty.addSubview(stack)
        stack.addArrangedSubview(title("还没有可显示的内容", size: 18))
        stack.addArrangedSubview(copy("本机缓存会保留；登录后将继续读取服务器和网页版数据。"))
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        for (index, action) in actions.enumerated() {
            row.addArrangedSubview(button(action.0, primary: index == 0) { [weak self] in self?.renderSection(action.1) })
        }
        stack.addArrangedSubview(row)
        pin(stack, to: empty, inset: 20)
        root.addArrangedSubview(empty)
    }

    private func buildChatWorkspace(in root: NSStackView) {
        root.addArrangedSubview(pageHeading("配镜聊天", "选择 Kimi 2.6、闪闪或已入驻商家，消息与网页版使用同一服务器会话。"))
        let box = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        let field = NSTextField()
        field.placeholderString = "输入配镜问题或定制需求"
        field.stringValue = "请根据我的配镜档案，帮我整理下一步建议。"
        stack.addArrangedSubview(field)
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.addArrangedSubview(button("问 Kimi 2.6", primary: true) { [weak self, weak field] in self?.sendMessage(field?.stringValue ?? "", merchantId: "kimi", merchantName: "Kimi 2.6 配镜顾问") })
        row.addArrangedSubview(button("联系闪闪") { [weak self, weak field] in self?.sendMessage(field?.stringValue ?? "", merchantId: "u_1772857774898ls0t6", merchantName: "闪闪") })
        stack.addArrangedSubview(row)
        pin(stack, to: box, inset: 20)
        root.addArrangedSubview(box)
    }

    private func sendMessage(_ text: String, merchantId: String, merchantName: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let uid = (currentUser?["uid"] as? String) ?? "mac_anonymous"
        let name = (currentUser?["nickname"] as? String) ?? (currentUser?["username"] as? String) ?? "匿名用户"
        post("/glasses/chat/message", body: ["uid": uid, "role": "customer", "text": text, "merchantId": merchantId, "merchantName": merchantName, "customerName": name]) { [weak self] data in
            self?.showMessage((data["success"] as? Bool) == true ? "消息已发送给\(merchantName)。" : String(describing: data["message"] ?? data["error"] ?? "发送失败"))
        }
    }

    private func hero() -> NSView {
        let box = card()
        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 18
        row.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(row)

        let icon = NSImageView()
        icon.image = NSImage(named: "AppIcon")
        icon.imageScaling = .scaleProportionallyUpOrDown
        row.addArrangedSubview(icon)
        icon.widthAnchor.constraint(equalToConstant: 72).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 72).isActive = true

        let text = NSStackView()
        text.orientation = .vertical
        text.spacing = 8
        text.addArrangedSubview(title("铮铮眼镜", size: 32))
        text.addArrangedSubview(copy("在 Mac 上查看配镜档案、整理心愿镜框，并继续与顾问和商家沟通。"))
        row.addArrangedSubview(text)

        let version = pill("v\(appVersion) · build \(appBuild)")
        row.addArrangedSubview(version)

        pin(row, to: box, inset: 22)
        return box
    }

    private func accountCard() -> NSView {
        let box = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)

        stack.addArrangedSubview(title("账号", size: 20))
        accountLabel.font = .boldSystemFont(ofSize: 18)
        accountLabel.textColor = ink()
        detailLabel.textColor = muted()
        detailLabel.lineBreakMode = .byWordWrapping
        detailLabel.maximumNumberOfLines = 0
        stack.addArrangedSubview(accountLabel)
        stack.addArrangedSubview(detailLabel)

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 10
        buttons.addArrangedSubview(button("通行证登录", primary: true) { [weak self] in self?.showLogin() })
        buttons.addArrangedSubview(button("注册账号") { [weak self] in self?.showRegister() })
        buttons.addArrangedSubview(button("临时配镜用户") { [weak self] in self?.showTemporaryUser() })
        buttons.addArrangedSubview(button("退出") { [weak self] in self?.logout() })
        stack.addArrangedSubview(buttons)

        pin(stack, to: box, inset: 20)
        return box
    }

    private func actionGrid() -> NSView {
        let grid = NSGridView(views: [
            [actionCard("开始配镜", "按步骤采集人脸关键点、试戴、生成报告。", "/onboard.html"),
             actionCard("顾客工作台", "查看已采集参数、心愿单、试戴图和报告。", "/customer.html")],
            [actionCard("配镜聊天", "把验光单、心愿单和定制需求发给顾问或商家。", "/chat.html"),
             actionCard("商家中心", "入驻、上传镜框、处理订单和回复顾客。", "/merchant.html")],
            [actionCard("项目 PPT", "查看 WAIC 展示材料。", "/ppt.html"),
             actionCard("网站首页", "回到线上 Demo 总入口。", "/index.html")]
        ])
        grid.rowSpacing = 14
        grid.columnSpacing = 14
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.column(at: 0).xPlacement = .fill
        grid.column(at: 1).xPlacement = .fill
        return grid
    }

    private func infoStrip() -> NSView {
        let box = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        stack.addArrangedSubview(title("当前阶段", size: 20))
        stack.addArrangedSubview(copy("App 与网页版共用铮铮通行证、配镜档案、心愿单和服务器会话。移动端完成采集后，可以在这台 Mac 上继续整理报告和沟通。"))
        updateLabel.textColor = muted()
        stack.addArrangedSubview(updateLabel)
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.addArrangedSubview(button("检查更新") { [weak self] in self?.checkUpdates(showAlert: true) })
        row.addArrangedSubview(button("下载说明") { self.showMessage("下载中心现在由 manifest.json 统一管理版本。正式用户只需要点“检查更新”，不需要看到 JSON 文件。") })
        stack.addArrangedSubview(row)
        pin(stack, to: box, inset: 20)
        return box
    }

    private func footer() -> NSView {
        let text = copy("登录数据会随 URL 参数带入线上流程；临时用户只适合演示和现场体验，正式使用建议登录通行证。")
        text.alignment = .center
        return text
    }

    private func actionCard(_ name: String, _ desc: String, _ path: String) -> NSView {
        let box = card()
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        stack.addArrangedSubview(title(name, size: 19))
        stack.addArrangedSubview(copy(desc))
        stack.addArrangedSubview(button("进入") { [weak self] in self?.showNativeFeature(name: name, desc: desc, path: path) })
        pin(stack, to: box, inset: 18)
        return box
    }

    private func showNativeFeature(name: String, desc: String, path: String) {
        switch path {
        case "/onboard.html": renderSection("fit")
        case "/customer.html": renderSection("profile")
        case "/chat.html": renderSection("chat")
        case "/merchant.html": renderSection("merchant")
        default: renderSection("home")
        }
    }

    private func showLogin() {
        let fields = form([("用户名 / 手机 / 邮箱", false), ("密码", true)])
        let alert = alert(title: "通行证登录", message: "在 App 内直接登录，不跳转浏览器。", fields: fields.views)
        if alert.runModal() == .alertFirstButtonReturn {
            let account = fields.inputs[0].stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            let password = fields.inputs[1].stringValue
            login(account: account, password: password)
        }
    }

    private func showRegister() {
        let fields = form([("用户名", false), ("昵称", false), ("邮箱", false), ("密码，至少 12 位", true)])
        let alert = alert(title: "注册通行证", message: "注册后会作为铮铮眼镜正式用户同步数据。", fields: fields.views)
        if alert.runModal() == .alertFirstButtonReturn {
            register(
                username: fields.inputs[0].stringValue,
                nickname: fields.inputs[1].stringValue,
                email: fields.inputs[2].stringValue,
                password: fields.inputs[3].stringValue
            )
        }
    }

    private func showTemporaryUser() {
        let fields = form([("显示名称", false)])
        fields.inputs[0].stringValue = "临时顾客"
        let alert = alert(title: "临时配镜用户", message: "只在当前 App 会话中使用，适合现场快速演示。", fields: fields.views)
        if alert.runModal() == .alertFirstButtonReturn {
            let name = fields.inputs[0].stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            let finalName = name.isEmpty ? "临时顾客" : name
            setUser(["uid": "temp_glasses_\(Int(Date().timeIntervalSince1970))", "username": finalName, "nickname": finalName, "temporary": true, "source": "glasses-app"])
        }
    }

    private func login(account: String, password: String) {
        guard !account.isEmpty, !password.isEmpty else { return showMessage("请填写账号和密码。") }
        post("/zz-pass/login", body: ["account": account, "username": account, "password": password]) { [weak self] data in
            guard let self else { return }
            if let user = data["user"] as? [String: Any] {
                self.setUser(user)
                self.showMessage("登录成功。")
            } else {
                self.showMessage(String(describing: data["message"] ?? data["error"] ?? "登录失败"))
            }
        }
    }

    private func register(username: String, nickname: String, email: String, password: String) {
        guard !username.isEmpty, !password.isEmpty else { return showMessage("请填写用户名和密码。") }
        post("/zz-pass/register", body: ["username": username, "nickname": nickname, "email": email, "password": password]) { [weak self] data in
            guard let self else { return }
            if let user = data["user"] as? [String: Any] {
                self.setUser(user)
                self.showMessage("注册成功，已登录。")
            } else {
                self.showMessage(String(describing: data["message"] ?? data["error"] ?? "注册失败"))
            }
        }
    }

    private func setUser(_ user: [String: Any]) {
        currentUser = user
        if let data = try? JSONSerialization.data(withJSONObject: user) {
            UserDefaults.standard.set(data, forKey: "zz_glasses_user")
        }
        let name = (user["nickname"] as? String) ?? (user["username"] as? String) ?? "匿名用户"
        let uid = (user["uid"] as? String) ?? (user["id"] as? String) ?? ""
        let temporary = (user["temporary"] as? Bool) == true
        accountLabel.stringValue = temporary ? "\(name) · 临时配镜用户" : "\(name) · 已登录"
        detailLabel.stringValue = uid.isEmpty ? "身份信息已准备好，可进入配镜流程。" : "UID：\(uid)。进入采集、试戴和聊天时会自动带上账号信息。"
    }

    private func logout() {
        currentUser = nil
        UserDefaults.standard.removeObject(forKey: "zz_glasses_user")
        accountLabel.stringValue = "未登录"
        detailLabel.stringValue = "可以先创建临时配镜用户，或登录铮铮通行证同步数据。"
        renderSection("home")
    }

    private func loadSession() {
        fittingStep = max(1, min(5, UserDefaults.standard.integer(forKey: "zz_glasses_fitting_step")))
        if UserDefaults.standard.object(forKey: "zz_glasses_fitting_step") == nil { fittingStep = 1 }
        faceWidth = UserDefaults.standard.string(forKey: "zz_glasses_face_width") ?? "139"
        pd = UserDefaults.standard.string(forKey: "zz_glasses_pd") ?? "63"
        bridgeWidth = UserDefaults.standard.string(forKey: "zz_glasses_bridge") ?? "18"
        rightDegree = UserDefaults.standard.string(forKey: "zz_glasses_right_degree") ?? ""
        leftDegree = UserDefaults.standard.string(forKey: "zz_glasses_left_degree") ?? ""
        selectedFrame = UserDefaults.standard.string(forKey: "zz_glasses_selected_frame") ?? "雾银圆框"
        templeLength = UserDefaults.standard.string(forKey: "zz_glasses_temple") ?? "145"
        customizationNote = UserDefaults.standard.string(forKey: "zz_glasses_custom_note") ?? ""
        if let data = UserDefaults.standard.data(forKey: "zz_glasses_user"),
           let user = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            setUser(user)
        }
    }

    private func post(_ path: String, body: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        var request = URLRequest(url: apiRoot.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { data, _, error in
            var result: [String: Any] = ["success": false, "error": error?.localizedDescription ?? "网络请求失败"]
            if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                result = json
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    private func checkUpdates(showAlert: Bool) {
        URLSession.shared.dataTask(with: manifestURL) { [weak self] data, _, _ in
            guard let self else { return }
            var message = "当前已是最新版本。"
            if let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let apps = json["apps"] as? [[String: Any]],
               let item = apps.first(where: { ($0["id"] as? String) == appUpdateId }) {
                let build = item["build"] as? Int ?? 0
                let version = item["version"] as? String ?? ""
                message = build > appBuild ? "发现新版本 \(version)，请到下载中心更新。" : "当前已是最新版本 \(appVersion)。"
            }
            DispatchQueue.main.async {
                self.updateLabel.stringValue = message
                if showAlert { self.showMessage(message) }
            }
        }.resume()
    }

    private func card() -> NSView {
        let view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.white.cgColor
        view.layer?.cornerRadius = 14
        view.layer?.borderWidth = 1
        view.layer?.borderColor = NSColor(calibratedRed: 0.82, green: 0.90, blue: 0.89, alpha: 1).cgColor
        return view
    }

    private func title(_ text: String, size: CGFloat) -> NSTextField {
        let view = NSTextField(labelWithString: text)
        view.font = .boldSystemFont(ofSize: size)
        view.textColor = ink()
        return view
    }

    private func copy(_ text: String) -> NSTextField {
        let view = NSTextField(labelWithString: text)
        view.font = .systemFont(ofSize: 14)
        view.textColor = muted()
        view.lineBreakMode = .byWordWrapping
        view.maximumNumberOfLines = 0
        return view
    }

    private func pill(_ text: String) -> NSTextField {
        let view = NSTextField(labelWithString: text)
        view.font = .boldSystemFont(ofSize: 12)
        view.textColor = NSColor(calibratedRed: 0.05, green: 0.43, blue: 0.38, alpha: 1)
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedRed: 0.91, green: 0.97, blue: 0.95, alpha: 1).cgColor
        view.layer?.cornerRadius = 10
        return view
    }

    private func button(_ text: String, primary: Bool = false, action: @escaping () -> Void) -> NSButton {
        let button = NSButton(title: text, target: nil, action: nil)
        button.isBordered = false
        button.font = .boldSystemFont(ofSize: 14)
        button.contentTintColor = primary ? .white : NSColor(calibratedRed: 0.05, green: 0.43, blue: 0.38, alpha: 1)
        button.wantsLayer = true
        button.layer?.backgroundColor = primary
            ? NSColor(calibratedRed: 0.05, green: 0.49, blue: 0.43, alpha: 1).cgColor
            : NSColor(calibratedRed: 0.91, green: 0.97, blue: 0.95, alpha: 1).cgColor
        button.layer?.cornerRadius = 8
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 34).isActive = true
        let sleeve = ClosureSleeve(action)
        sleeves.append(sleeve)
        button.target = sleeve
        button.action = #selector(ClosureSleeve.invoke)
        return button
    }

    private func form(_ specs: [(String, Bool)]) -> (views: NSView, inputs: [NSTextField]) {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 8
        var inputs: [NSTextField] = []
        for spec in specs {
            let field: NSTextField = spec.1 ? NSSecureTextField() : NSTextField()
            field.placeholderString = spec.0
            field.frame.size.width = 320
            inputs.append(field)
            stack.addArrangedSubview(field)
        }
        return (stack, inputs)
    }

    private func alert(title: String, message: String, fields: NSView) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.accessoryView = fields
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        return alert
    }

    private func showMessage(_ text: String) {
        let alert = NSAlert()
        alert.messageText = text
        alert.addButton(withTitle: "知道了")
        alert.runModal()
    }

    private func pin(_ child: NSView, to parent: NSView, inset: CGFloat) {
        NSLayoutConstraint.activate([
            child.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: inset),
            child.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -inset),
            child.topAnchor.constraint(equalTo: parent.topAnchor, constant: inset),
            child.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -inset)
        ])
    }

    private func ink() -> NSColor {
        NSColor(calibratedRed: 0.05, green: 0.14, blue: 0.17, alpha: 1)
    }

    private func muted() -> NSColor {
        NSColor(calibratedRed: 0.35, green: 0.43, blue: 0.46, alpha: 1)
    }
}

final class ClosureSleeve: NSObject {
    private let closure: () -> Void
    init(_ closure: @escaping () -> Void) { self.closure = closure }
    @objc func invoke() { closure() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
