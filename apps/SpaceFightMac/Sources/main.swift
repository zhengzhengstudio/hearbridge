import Cocoa
import SpriteKit

private let appVersion = "0.12.0"
private let appBuild = 63
private let updateId = "spacefight-macos"
private let manifestURL = URL(string: "https://zhengzhengstudio.cn/api/apps/manifest.json")!
private let passportURL = URL(string: "https://zhengzhengstudio.cn/api/auth/login")!
private let loadoutWeapons = ["脉冲炮", "散射炮", "追踪导弹", "磁轨炮", "等离子炮"]
private let loadoutDevices = ["猎手阵列", "纳米修复", "弹药织机", "牵引收集器", "神盾投射器"]
private let loadoutCores = ["均衡核心", "矢量核心", "堡垒核心", "反应堆核心", "幻影核心", "无畏核心"]

private func isRemoteReleaseNewer(version: String, build: Int) -> Bool {
    let remote = version.split(separator: ".").map { Int($0) ?? 0 }
    let local = appVersion.split(separator: ".").map { Int($0) ?? 0 }
    for index in 0..<max(remote.count, local.count) {
        let remotePart = index < remote.count ? remote[index] : 0
        let localPart = index < local.count ? local[index] : 0
        if remotePart != localPart { return remotePart > localPart }
    }
    return build > appBuild
}

private let macKeyChoices: [(String, UInt16)] = [
    ("W", 13), ("A", 0), ("S", 1), ("D", 2),
    ("I", 34), ("J", 38), ("K", 40), ("L", 37),
    ("↑", 126), ("←", 123), ("↓", 125), ("→", 124),
    ("空格", 49), ("回车", 36), ("左 Control", 59),
    ("V", 9), ("C", 8), ("Tab", 48)
]

private struct MissionOption {
    let mission: SFMissionKind
    let code: String
    let title: String
    let objective: String
    let pressure: String

    var mode: String { mission.rawValue }
}

private let offlineMissions = SFMissionKind.allCases.enumerated().map { index, mission -> MissionOption in
    let code = String(format: "%02d", index + 1)
    switch mission {
    case .survival:
        return MissionOption(mission: mission, code: code, title: "边境生存", objective: "抵御无限升级敌潮并刷新纪录", pressure: "持续作战  ·  风暴区")
    case .boss:
        return MissionOption(mission: mission, code: code, title: "组件猎杀", objective: "摧毁三个武器组件后击穿核心", pressure: "重型目标  ·  风暴区")
    case .escort:
        return MissionOption(mission: mission, code: code, title: "护航走廊", objective: "保护运输舰完整穿越峡谷战区", pressure: "目标防护  ·  峡谷区")
    case .defense:
        return MissionOption(mission: mission, code: code, title: "阵地控制", objective: "清空信标周边并完成区域占领", pressure: "据点争夺  ·  峡谷区")
    case .timed:
        return MissionOption(mission: mission, code: code, title: "限时歼灭", objective: "在倒计时结束前完成十八次击毁", pressure: "时间压力  ·  风暴区")
    case .raid:
        return MissionOption(mission: mission, code: code, title: "资源突袭", objective: "突破守军并回收八份战区资源", pressure: "搜索回收  ·  峡谷区")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "SpaceFight"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.018, green: 0.024, blue: 0.03, alpha: 1)
        window.minSize = NSSize(width: 760, height: 480)
        window.contentViewController = SpaceFightViewController()
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.acceptsMouseMovedEvents = true
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

private class HoverButton: NSButton {
    var normalColor = NSColor(red: 0.035, green: 0.048, blue: 0.058, alpha: 0.86)
    var hoverColor = NSColor(red: 0.075, green: 0.09, blue: 0.1, alpha: 0.96)
    var pressedColor = NSColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.24)
    private var tracking: NSTrackingArea?
    private var hovering = false

    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        tracking = NSTrackingArea(
            rect: bounds,
            options: [.activeInKeyWindow, .mouseEnteredAndExited, .inVisibleRect],
            owner: self
        )
        addTrackingArea(tracking!)
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        hovering = true
        layer?.backgroundColor = hoverColor.cgColor
    }

    override func mouseExited(with event: NSEvent) {
        hovering = false
        layer?.backgroundColor = normalColor.cgColor
    }

    override func mouseDown(with event: NSEvent) {
        layer?.backgroundColor = pressedColor.cgColor
        super.mouseDown(with: event)
        layer?.backgroundColor = (hovering ? hoverColor : normalColor).cgColor
    }
}

private final class FlippedStackView: NSStackView {
    override var isFlipped: Bool { true }
}

private final class MissionButton: HoverButton {
    let mode: String
    private let option: MissionOption
    private(set) var isMissionSelected = false

    init(option: MissionOption, target: AnyObject?, action: Selector?) {
        self.option = option
        mode = option.mode
        super.init(frame: .zero)
        self.target = target
        self.action = action
        translatesAutoresizingMaskIntoConstraints = false
        isBordered = false
        wantsLayer = true
        layer?.cornerRadius = 3
        layer?.borderWidth = 1
        focusRingType = .exterior
        bezelStyle = .regularSquare
        alignment = .left
        imagePosition = .noImage
        setButtonType(.momentaryChange)
        toolTip = option.objective
        heightAnchor.constraint(equalToConstant: 54).isActive = true
        keyEquivalent = String(option.code.suffix(1))
        updateSelection(false)
    }

    required init?(coder: NSCoder) { nil }

    override var acceptsFirstResponder: Bool { true }

    func updateSelection(_ selected: Bool) {
        isMissionSelected = selected
        normalColor = selected
            ? NSColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.14)
            : NSColor(red: 0.025, green: 0.035, blue: 0.044, alpha: 0.78)
        hoverColor = selected
            ? NSColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.22)
            : NSColor(red: 0.075, green: 0.09, blue: 0.1, alpha: 0.96)
        layer?.backgroundColor = normalColor.cgColor
        layer?.borderColor = selected
            ? NSColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.9).cgColor
            : NSColor(white: 0.64, alpha: 0.2).cgColor

        let text = "\(option.code)   \(option.title)\n      \(option.objective)"
        let attributed = NSMutableAttributedString(
            string: text,
            attributes: [
                .foregroundColor: selected ? NSColor(white: 0.95, alpha: 1) : NSColor(white: 0.69, alpha: 1),
                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
            ]
        )
        let subtitleRange = (text as NSString).range(of: option.objective)
        attributed.addAttributes([
            .foregroundColor: selected ? NSColor(white: 0.7, alpha: 1) : NSColor(white: 0.48, alpha: 1),
            .font: NSFont.systemFont(ofSize: 10, weight: .medium)
        ], range: subtitleRange)
        attributedTitle = attributed
    }
}

final class SpaceFightViewController: NSViewController {
    private let gameView = SKView()
    private let scene = NativeGameScene()
    private let deckOverlay = NSView()
    private let armoryOverlay = NSView()
    private let settingsOverlay = NSView()
    private let statusLabel = NSTextField(labelWithString: "正在装载本机战区")
    private let objectiveLabel = NSTextField(labelWithString: "")
    private let pressureLabel = NSTextField(labelWithString: "")
    private let loginButton = HoverButton()
    private let launchButton = HoverButton()
    private let combatUtilities = NSStackView()
    private var armorySelector: NSSegmentedControl!
    private var deviceSelector: NSSegmentedControl!
    private var coreSelector: NSSegmentedControl!
    private var keySelectors: [String: NSPopUpButton] = [:]
    private var sensitivitySelector: NSSegmentedControl!
    private var missionButtons: [MissionButton] = []
    private var selectedMode = SFMissionKind.survival.rawValue
    private var selectedWeapon = min(4, max(0, UserDefaults.standard.integer(forKey: "spacefight.startingWeapon")))
    private var selectedDevice = min(4, max(0, UserDefaults.standard.integer(forKey: "spacefight.tacticalDevice")))
    private var selectedCore = min(5, max(0, UserDefaults.standard.integer(forKey: "spacefight.frameCore")))

    override func loadView() {
        view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(red: 0.018, green: 0.024, blue: 0.03, alpha: 1).cgColor
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildInterface()
        bindScene()
        selectMission(SFMissionKind.survival.rawValue)
        statusLabel.stringValue = "离线可用 · 本机任务已就绪"
        checkUpdates(manual: false)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.makeFirstResponder(missionButtons.first)
    }

    private func buildInterface() {
        gameView.translatesAutoresizingMaskIntoConstraints = false
        gameView.preferredFramesPerSecond = 60
        gameView.ignoresSiblingOrder = true
        gameView.presentScene(scene)
        view.addSubview(gameView)

        deckOverlay.translatesAutoresizingMaskIntoConstraints = false
        deckOverlay.wantsLayer = true
        view.addSubview(deckOverlay)

        let topBar = NSView()
        topBar.translatesAutoresizingMaskIntoConstraints = false
        topBar.wantsLayer = true
        topBar.layer?.backgroundColor = NSColor(red: 0.018, green: 0.026, blue: 0.033, alpha: 0.92).cgColor
        deckOverlay.addSubview(topBar)

        let mark = NSView()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.wantsLayer = true
        mark.layer?.backgroundColor = amber.cgColor
        topBar.addSubview(mark)

        let title = label("SPACEFIGHT", size: 17, color: NSColor(white: 0.96, alpha: 1), weight: .black, mono: true)
        topBar.addSubview(title)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
        statusLabel.textColor = NSColor(white: 0.62, alpha: 1)
        statusLabel.lineBreakMode = .byTruncatingTail
        topBar.addSubview(statusLabel)

        loginButton.translatesAutoresizingMaskIntoConstraints = false
        configureSymbolButton(loginButton, symbol: "person.badge.key", label: "通行证登录", action: #selector(showLogin))
        let profile = symbolButton("person.crop.circle", label: "我的资料", action: #selector(showProfile))
        let update = symbolButton("arrow.triangle.2.circlepath", label: "检查更新", action: #selector(manualUpdate))
        let armory = symbolButton("wrench.and.screwdriver", label: "战备整备台", action: #selector(showArmory))
        let settings = symbolButton("slider.horizontal.3", label: "控制中心", action: #selector(showSettings))
        let utilities = NSStackView(views: [loginButton, armory, settings, profile, update])
        utilities.translatesAutoresizingMaskIntoConstraints = false
        utilities.orientation = .horizontal
        utilities.spacing = 3
        topBar.addSubview(utilities)

        let railHeader = NSStackView()
        railHeader.translatesAutoresizingMaskIntoConstraints = false
        railHeader.orientation = .vertical
        railHeader.alignment = .leading
        railHeader.spacing = 5
        deckOverlay.addSubview(railHeader)
        let kicker = label("LOCAL MISSIONS / 60 HZ", size: 10, color: amber, weight: .bold, mono: true)
        railHeader.addArrangedSubview(kicker)
        let controls = label("WASD 移动 · 鼠标瞄准开火 · 1–5 武器 · V 视角", size: 10, color: NSColor(white: 0.72, alpha: 1), weight: .semibold)
        railHeader.addArrangedSubview(controls)

        let missionScroll = NSScrollView()
        missionScroll.translatesAutoresizingMaskIntoConstraints = false
        missionScroll.drawsBackground = false
        missionScroll.borderType = .noBorder
        missionScroll.hasVerticalScroller = true
        missionScroll.hasHorizontalScroller = false
        missionScroll.autohidesScrollers = true
        deckOverlay.addSubview(missionScroll)

        let rail = FlippedStackView()
        rail.translatesAutoresizingMaskIntoConstraints = false
        rail.orientation = .vertical
        rail.alignment = .leading
        rail.spacing = 6
        missionScroll.documentView = rail
        for option in offlineMissions {
            let button = MissionButton(option: option, target: self, action: #selector(selectMissionButton(_:)))
            missionButtons.append(button)
            rail.addArrangedSubview(button)
            button.widthAnchor.constraint(equalTo: rail.widthAnchor).isActive = true
        }

        let onlineRule = NSView()
        onlineRule.translatesAutoresizingMaskIntoConstraints = false
        onlineRule.wantsLayer = true
        onlineRule.layer?.backgroundColor = NSColor(white: 0.65, alpha: 0.18).cgColor
        onlineRule.heightAnchor.constraint(equalToConstant: 1).isActive = true
        onlineRule.widthAnchor.constraint(equalTo: rail.widthAnchor).isActive = true
        rail.setCustomSpacing(10, after: missionButtons.last!)
        rail.addArrangedSubview(onlineRule)

        let publicButton = HoverButton(title: "  公开协作    次级在线模式 · 需要网络", target: self, action: #selector(selectPublic))
        publicButton.translatesAutoresizingMaskIntoConstraints = false
        publicButton.isBordered = false
        publicButton.wantsLayer = true
        publicButton.layer?.cornerRadius = 3
        publicButton.layer?.borderWidth = 1
        publicButton.layer?.borderColor = NSColor(white: 0.64, alpha: 0.18).cgColor
        publicButton.font = .systemFont(ofSize: 11, weight: .medium)
        publicButton.contentTintColor = NSColor(white: 0.64, alpha: 1)
        publicButton.alignment = .left
        publicButton.image = NSImage(systemSymbolName: "network", accessibilityDescription: "在线")
        publicButton.imagePosition = .imageLeading
        publicButton.imageHugsTitle = true
        publicButton.toolTip = "公开协作，次级在线模式，需要网络"
        publicButton.focusRingType = .exterior
        publicButton.heightAnchor.constraint(equalToConstant: 42).isActive = true
        publicButton.widthAnchor.constraint(equalTo: rail.widthAnchor).isActive = true
        rail.addArrangedSubview(publicButton)

        let missionReadout = NSView()
        missionReadout.translatesAutoresizingMaskIntoConstraints = false
        missionReadout.wantsLayer = true
        missionReadout.layer?.backgroundColor = NSColor(red: 0.018, green: 0.026, blue: 0.033, alpha: 0.76).cgColor
        missionReadout.layer?.borderColor = NSColor(white: 0.7, alpha: 0.16).cgColor
        missionReadout.layer?.borderWidth = 1
        deckOverlay.addSubview(missionReadout)
        let ready = label("INTERCEPTOR / READY", size: 10, color: amber, weight: .bold, mono: true)
        missionReadout.addSubview(ready)
        objectiveLabel.translatesAutoresizingMaskIntoConstraints = false
        objectiveLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        objectiveLabel.textColor = NSColor(white: 0.9, alpha: 1)
        objectiveLabel.lineBreakMode = .byTruncatingTail
        missionReadout.addSubview(objectiveLabel)
        pressureLabel.translatesAutoresizingMaskIntoConstraints = false
        pressureLabel.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
        pressureLabel.textColor = NSColor(white: 0.6, alpha: 1)
        missionReadout.addSubview(pressureLabel)

        launchButton.translatesAutoresizingMaskIntoConstraints = false
        launchButton.title = "启动任务"
        launchButton.target = self
        launchButton.action = #selector(startGame)
        launchButton.keyEquivalent = "\r"
        launchButton.isBordered = false
        launchButton.wantsLayer = true
        launchButton.normalColor = amber
        launchButton.hoverColor = NSColor(red: 1, green: 0.72, blue: 0.37, alpha: 1)
        launchButton.pressedColor = NSColor(red: 0.82, green: 0.51, blue: 0.19, alpha: 1)
        launchButton.layer?.backgroundColor = amber.cgColor
        launchButton.layer?.cornerRadius = 3
        launchButton.font = .systemFont(ofSize: 14, weight: .bold)
        launchButton.contentTintColor = NSColor(red: 0.07, green: 0.075, blue: 0.08, alpha: 1)
        launchButton.image = NSImage(systemSymbolName: "arrow.up.right", accessibilityDescription: "启动")
        launchButton.imagePosition = .imageTrailing
        launchButton.imageHugsTitle = true
        launchButton.toolTip = "启动已选任务"
        deckOverlay.addSubview(launchButton)

        let back = symbolButton("chevron.backward", label: "返回战备台", action: #selector(returnToLaunch))
        let camera = symbolButton("camera.viewfinder", label: "切换视角（V 键）", action: #selector(toggleCamera))
        let pause = symbolButton("pause.fill", label: "暂停", action: #selector(showPause))
        combatUtilities.translatesAutoresizingMaskIntoConstraints = false
        combatUtilities.orientation = .horizontal
        combatUtilities.spacing = 4
        combatUtilities.addArrangedSubview(back)
        combatUtilities.addArrangedSubview(camera)
        combatUtilities.addArrangedSubview(pause)
        combatUtilities.isHidden = true
        view.addSubview(combatUtilities)

        NSLayoutConstraint.activate([
            gameView.topAnchor.constraint(equalTo: view.topAnchor),
            gameView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            gameView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            gameView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            deckOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            deckOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            deckOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            deckOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            topBar.topAnchor.constraint(equalTo: view.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 58),
            mark.leadingAnchor.constraint(equalTo: topBar.leadingAnchor, constant: 18),
            mark.centerYAnchor.constraint(equalTo: topBar.centerYAnchor, constant: 5),
            mark.widthAnchor.constraint(equalToConstant: 4),
            mark.heightAnchor.constraint(equalToConstant: 28),
            title.leadingAnchor.constraint(equalTo: mark.trailingAnchor, constant: 10),
            title.centerYAnchor.constraint(equalTo: mark.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 16),
            statusLabel.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            utilities.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -12),
            utilities.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: utilities.leadingAnchor, constant: -10),

            railHeader.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            railHeader.topAnchor.constraint(equalTo: topBar.bottomAnchor, constant: 20),
            railHeader.widthAnchor.constraint(equalToConstant: 292),
            missionScroll.leadingAnchor.constraint(equalTo: railHeader.leadingAnchor),
            missionScroll.topAnchor.constraint(equalTo: railHeader.bottomAnchor, constant: 12),
            missionScroll.widthAnchor.constraint(equalTo: railHeader.widthAnchor),
            missionScroll.bottomAnchor.constraint(equalTo: launchButton.topAnchor, constant: -14),
            rail.leadingAnchor.constraint(equalTo: missionScroll.contentView.leadingAnchor),
            rail.topAnchor.constraint(equalTo: missionScroll.contentView.topAnchor),
            rail.widthAnchor.constraint(equalTo: missionScroll.contentView.widthAnchor),
            launchButton.leadingAnchor.constraint(equalTo: railHeader.leadingAnchor),
            launchButton.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -24),
            launchButton.widthAnchor.constraint(equalTo: railHeader.widthAnchor),
            launchButton.heightAnchor.constraint(equalToConstant: 44),

            missionReadout.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            missionReadout.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -24),
            missionReadout.widthAnchor.constraint(equalToConstant: 272),
            missionReadout.heightAnchor.constraint(equalToConstant: 72),
            ready.leadingAnchor.constraint(equalTo: missionReadout.leadingAnchor, constant: 12),
            ready.topAnchor.constraint(equalTo: missionReadout.topAnchor, constant: 9),
            objectiveLabel.leadingAnchor.constraint(equalTo: ready.leadingAnchor),
            objectiveLabel.trailingAnchor.constraint(equalTo: missionReadout.trailingAnchor, constant: -10),
            objectiveLabel.topAnchor.constraint(equalTo: ready.bottomAnchor, constant: 5),
            pressureLabel.leadingAnchor.constraint(equalTo: ready.leadingAnchor),
            pressureLabel.topAnchor.constraint(equalTo: objectiveLabel.bottomAnchor, constant: 3),

            combatUtilities.topAnchor.constraint(equalTo: view.topAnchor, constant: 16),
            combatUtilities.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12)
        ])
        buildArmoryOverlay()
        buildSettingsOverlay()
    }

    private func buildArmoryOverlay() {
        armoryOverlay.translatesAutoresizingMaskIntoConstraints = false
        armoryOverlay.wantsLayer = true
        armoryOverlay.layer?.backgroundColor = NSColor(red: 0.018, green: 0.026, blue: 0.032, alpha: 0.98).cgColor
        armoryOverlay.isHidden = true
        view.addSubview(armoryOverlay)

        let header = NSView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.wantsLayer = true
        header.layer?.backgroundColor = NSColor(red: 0.022, green: 0.031, blue: 0.038, alpha: 1).cgColor
        header.layer?.borderColor = NSColor(white: 0.68, alpha: 0.2).cgColor
        header.layer?.borderWidth = 1
        armoryOverlay.addSubview(header)

        let back = HoverButton(title: "返回机库", target: self, action: #selector(closeArmory))
        back.translatesAutoresizingMaskIntoConstraints = false
        back.isBordered = false
        back.wantsLayer = true
        back.layer?.backgroundColor = back.normalColor.cgColor
        back.layer?.borderColor = NSColor(white: 0.68, alpha: 0.28).cgColor
        back.layer?.borderWidth = 1
        back.layer?.cornerRadius = 2
        back.contentTintColor = NSColor(white: 0.84, alpha: 1)
        header.addSubview(back)
        let title = label("战备整备台", size: 22, color: NSColor(white: 0.96, alpha: 1), weight: .black)
        header.addSubview(title)
        let state = label("LOCAL / SF-09", size: 10, color: amber, weight: .bold, mono: true)
        header.addSubview(state)

        let preview = NSView()
        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.wantsLayer = true
        preview.layer?.backgroundColor = NSColor(red: 0.025, green: 0.037, blue: 0.045, alpha: 0.82).cgColor
        preview.layer?.borderColor = NSColor(white: 0.66, alpha: 0.22).cgColor
        preview.layer?.borderWidth = 1
        armoryOverlay.addSubview(preview)
        let coordinate = label("HARDPOINT 01                         FRAME READY", size: 9, color: NSColor(white: 0.58, alpha: 1), weight: .bold, mono: true)
        preview.addSubview(coordinate)
        let shipImage = NSImageView()
        shipImage.translatesAutoresizingMaskIntoConstraints = false
        shipImage.imageScaling = .scaleProportionallyUpOrDown
        if let path = Bundle.main.path(forResource: "interceptor", ofType: "png") {
            shipImage.image = NSImage(contentsOfFile: path)
        }
        shipImage.toolTip = "SF-09 截击机"
        preview.addSubview(shipImage)
        let frameReadout = label("SF-09   装甲 100   护盾 80   五武器位", size: 11, color: NSColor(white: 0.9, alpha: 1), weight: .bold, mono: true)
        frameReadout.alignment = .center
        frameReadout.wantsLayer = true
        frameReadout.layer?.backgroundColor = NSColor(red: 0.02, green: 0.03, blue: 0.036, alpha: 0.9).cgColor
        preview.addSubview(frameReadout)

        let bank = NSView()
        bank.translatesAutoresizingMaskIntoConstraints = false
        bank.wantsLayer = true
        bank.layer?.backgroundColor = NSColor(red: 0.025, green: 0.037, blue: 0.045, alpha: 0.82).cgColor
        bank.layer?.borderColor = NSColor(white: 0.66, alpha: 0.22).cgColor
        bank.layer?.borderWidth = 1
        armoryOverlay.addSubview(bank)
        let bankTitle = label("01  主武器", size: 12, color: amber, weight: .bold, mono: true)
        bank.addSubview(bankTitle)
        armorySelector = NSSegmentedControl(labels: loadoutWeapons, trackingMode: .selectOne, target: nil, action: nil)
        armorySelector.translatesAutoresizingMaskIntoConstraints = false
        armorySelector.segmentStyle = .texturedSquare
        armorySelector.selectedSegment = selectedWeapon
        bank.addSubview(armorySelector)
        let deviceTitle = label("02  战术设备", size: 12, color: amber, weight: .bold, mono: true)
        bank.addSubview(deviceTitle)
        deviceSelector = NSSegmentedControl(labels: loadoutDevices, trackingMode: .selectOne, target: nil, action: nil)
        deviceSelector.translatesAutoresizingMaskIntoConstraints = false
        deviceSelector.segmentStyle = .texturedSquare
        deviceSelector.selectedSegment = selectedDevice
        bank.addSubview(deviceSelector)
        let coreTitle = label("03  机体核心", size: 12, color: amber, weight: .bold, mono: true)
        bank.addSubview(coreTitle)
        coreSelector = NSSegmentedControl(labels: loadoutCores, trackingMode: .selectOne, target: nil, action: nil)
        coreSelector.translatesAutoresizingMaskIntoConstraints = false
        coreSelector.segmentStyle = .texturedSquare
        coreSelector.selectedSegment = selectedCore
        bank.addSubview(coreSelector)
        let stats = label("完整配置会改变装甲、护盾、机动、能量循环和战术能力", size: 10, color: NSColor(white: 0.7, alpha: 1), weight: .bold, mono: true)
        bank.addSubview(stats)

        let footer = NSView()
        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.wantsLayer = true
        footer.layer?.backgroundColor = NSColor(red: 0.022, green: 0.031, blue: 0.038, alpha: 1).cgColor
        footer.layer?.borderColor = NSColor(white: 0.68, alpha: 0.2).cgColor
        footer.layer?.borderWidth = 1
        armoryOverlay.addSubview(footer)
        let hint = label("配置仅作用于本机任务", size: 10, color: NSColor(white: 0.6, alpha: 1), weight: .medium)
        footer.addSubview(hint)
        let confirm = HoverButton(title: "确认装配", target: self, action: #selector(applyArmory))
        confirm.translatesAutoresizingMaskIntoConstraints = false
        confirm.isBordered = false
        confirm.wantsLayer = true
        confirm.normalColor = amber
        confirm.hoverColor = NSColor(red: 1, green: 0.72, blue: 0.37, alpha: 1)
        confirm.layer?.backgroundColor = amber.cgColor
        confirm.layer?.cornerRadius = 2
        confirm.font = .systemFont(ofSize: 13, weight: .bold)
        confirm.contentTintColor = NSColor(red: 0.07, green: 0.075, blue: 0.08, alpha: 1)
        footer.addSubview(confirm)

        NSLayoutConstraint.activate([
            armoryOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            armoryOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            armoryOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            armoryOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            header.topAnchor.constraint(equalTo: armoryOverlay.topAnchor),
            header.leadingAnchor.constraint(equalTo: armoryOverlay.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: armoryOverlay.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 58),
            back.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 18),
            back.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            back.widthAnchor.constraint(equalToConstant: 104),
            back.heightAnchor.constraint(equalToConstant: 36),
            title.leadingAnchor.constraint(equalTo: back.trailingAnchor, constant: 16),
            title.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            state.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -20),
            state.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            footer.leadingAnchor.constraint(equalTo: armoryOverlay.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: armoryOverlay.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: armoryOverlay.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 62),
            hint.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 20),
            hint.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            confirm.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -20),
            confirm.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            confirm.widthAnchor.constraint(equalToConstant: 180),
            confirm.heightAnchor.constraint(equalToConstant: 42),
            preview.leadingAnchor.constraint(equalTo: armoryOverlay.leadingAnchor, constant: 24),
            preview.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 16),
            preview.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -16),
            preview.widthAnchor.constraint(equalTo: armoryOverlay.widthAnchor, multiplier: 0.44),
            bank.leadingAnchor.constraint(equalTo: preview.trailingAnchor, constant: 16),
            bank.trailingAnchor.constraint(equalTo: armoryOverlay.trailingAnchor, constant: -24),
            bank.topAnchor.constraint(equalTo: preview.topAnchor),
            bank.bottomAnchor.constraint(equalTo: preview.bottomAnchor),
            coordinate.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 14),
            coordinate.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -14),
            coordinate.topAnchor.constraint(equalTo: preview.topAnchor, constant: 12),
            shipImage.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 20),
            shipImage.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -20),
            shipImage.topAnchor.constraint(equalTo: coordinate.bottomAnchor, constant: 6),
            shipImage.bottomAnchor.constraint(equalTo: frameReadout.topAnchor, constant: -6),
            frameReadout.leadingAnchor.constraint(equalTo: preview.leadingAnchor),
            frameReadout.trailingAnchor.constraint(equalTo: preview.trailingAnchor),
            frameReadout.bottomAnchor.constraint(equalTo: preview.bottomAnchor),
            frameReadout.heightAnchor.constraint(equalToConstant: 46),
            bankTitle.leadingAnchor.constraint(equalTo: bank.leadingAnchor, constant: 18),
            bankTitle.topAnchor.constraint(equalTo: bank.topAnchor, constant: 18),
            armorySelector.leadingAnchor.constraint(equalTo: bank.leadingAnchor, constant: 18),
            armorySelector.trailingAnchor.constraint(equalTo: bank.trailingAnchor, constant: -18),
            armorySelector.topAnchor.constraint(equalTo: bankTitle.bottomAnchor, constant: 8),
            armorySelector.heightAnchor.constraint(equalToConstant: 42),
            deviceTitle.leadingAnchor.constraint(equalTo: bankTitle.leadingAnchor),
            deviceTitle.topAnchor.constraint(equalTo: armorySelector.bottomAnchor, constant: 17),
            deviceSelector.leadingAnchor.constraint(equalTo: armorySelector.leadingAnchor),
            deviceSelector.trailingAnchor.constraint(equalTo: armorySelector.trailingAnchor),
            deviceSelector.topAnchor.constraint(equalTo: deviceTitle.bottomAnchor, constant: 8),
            deviceSelector.heightAnchor.constraint(equalToConstant: 42),
            coreTitle.leadingAnchor.constraint(equalTo: bankTitle.leadingAnchor),
            coreTitle.topAnchor.constraint(equalTo: deviceSelector.bottomAnchor, constant: 17),
            coreSelector.leadingAnchor.constraint(equalTo: armorySelector.leadingAnchor),
            coreSelector.trailingAnchor.constraint(equalTo: armorySelector.trailingAnchor),
            coreSelector.topAnchor.constraint(equalTo: coreTitle.bottomAnchor, constant: 8),
            coreSelector.heightAnchor.constraint(equalToConstant: 42),
            stats.leadingAnchor.constraint(equalTo: bankTitle.leadingAnchor),
            stats.bottomAnchor.constraint(equalTo: bank.bottomAnchor, constant: -18)
        ])
    }

    private func buildSettingsOverlay() {
        settingsOverlay.translatesAutoresizingMaskIntoConstraints = false
        settingsOverlay.wantsLayer = true
        settingsOverlay.layer?.backgroundColor = NSColor(red: 0.018, green: 0.026, blue: 0.032, alpha: 0.98).cgColor
        settingsOverlay.isHidden = true
        view.addSubview(settingsOverlay)

        let panel = NSStackView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.orientation = .vertical
        panel.alignment = .leading
        panel.spacing = 8
        panel.edgeInsets = NSEdgeInsets(top: 22, left: 24, bottom: 22, right: 24)
        panel.wantsLayer = true
        panel.layer?.backgroundColor = NSColor(red: 0.035, green: 0.052, blue: 0.064, alpha: 0.97).cgColor
        panel.layer?.borderWidth = 1
        panel.layer?.borderColor = NSColor(white: 0.7, alpha: 0.24).cgColor
        settingsOverlay.addSubview(panel)

        panel.addArrangedSubview(label("控制中心", size: 24, color: NSColor(white: 0.96, alpha: 1), weight: .black))
        panel.addArrangedSubview(label("逐项调整键位与鼠标转向速度，配置保存在本机。", size: 11, color: NSColor(white: 0.68, alpha: 1), weight: .medium))
        let profile = SFControlProfile.saved()
        let actions: [(String, String, UInt16)] = [
            ("forward", "前进", profile.forwardKey),
            ("backward", "后退", profile.backwardKey),
            ("left", "左移", profile.leftKey),
            ("right", "右移", profile.rightKey),
            ("fire", "开火", profile.fireKey),
            ("camera", "切换视角", profile.cameraKey)
        ]
        keySelectors.removeAll()
        actions.forEach { action, title, selected in
            let row = NSStackView()
            row.orientation = .horizontal
            row.spacing = 12
            let caption = label(title, size: 12, color: NSColor(white: 0.86, alpha: 1), weight: .semibold)
            caption.widthAnchor.constraint(equalToConstant: 110).isActive = true
            row.addArrangedSubview(caption)
            let selector = NSPopUpButton(frame: .zero, pullsDown: false)
            selector.translatesAutoresizingMaskIntoConstraints = false
            selector.addItems(withTitles: macKeyChoices.map { $0.0 })
            selector.selectItem(withTitle: macKeyChoices.first(where: { $0.1 == selected })?.0 ?? "W")
            selector.widthAnchor.constraint(equalToConstant: 220).isActive = true
            keySelectors[action] = selector
            row.addArrangedSubview(selector)
            panel.addArrangedSubview(row)
        }
        let sensitivityRow = NSStackView()
        sensitivityRow.orientation = .horizontal
        sensitivityRow.spacing = 12
        let sensitivityLabel = label("鼠标灵敏度", size: 12, color: NSColor(white: 0.86, alpha: 1), weight: .semibold)
        sensitivityLabel.widthAnchor.constraint(equalToConstant: 110).isActive = true
        sensitivityRow.addArrangedSubview(sensitivityLabel)
        sensitivitySelector = NSSegmentedControl(labels: ["稳健", "标准", "迅捷"], trackingMode: .selectOne, target: nil, action: nil)
        sensitivitySelector.selectedSegment = profile.aimSensitivity < 0.85 ? 0 : (profile.aimSensitivity < 1.2 ? 1 : 2)
        sensitivitySelector.widthAnchor.constraint(equalToConstant: 220).isActive = true
        sensitivityRow.addArrangedSubview(sensitivitySelector)
        panel.addArrangedSubview(sensitivityRow)

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 8
        let cancel = HoverButton(title: "返回机库", target: self, action: #selector(closeSettings))
        let save = HoverButton(title: "保存控制方案", target: self, action: #selector(applySettings))
        save.normalColor = amber
        save.hoverColor = NSColor(red: 1, green: 0.72, blue: 0.37, alpha: 1)
        [cancel, save].forEach {
            $0.isBordered = false
            $0.wantsLayer = true
            $0.layer?.backgroundColor = ($0 === save ? amber : NSColor(red: 0.06, green: 0.085, blue: 0.1, alpha: 1)).cgColor
            $0.layer?.borderWidth = 1
            $0.layer?.borderColor = NSColor(white: 0.7, alpha: 0.28).cgColor
            $0.layer?.cornerRadius = 2
            $0.widthAnchor.constraint(equalToConstant: 170).isActive = true
            $0.heightAnchor.constraint(equalToConstant: 42).isActive = true
            buttons.addArrangedSubview($0)
        }
        panel.addArrangedSubview(buttons)
        NSLayoutConstraint.activate([
            settingsOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            settingsOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            settingsOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            settingsOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            panel.centerXAnchor.constraint(equalTo: settingsOverlay.centerXAnchor),
            panel.centerYAnchor.constraint(equalTo: settingsOverlay.centerYAnchor),
            panel.widthAnchor.constraint(equalToConstant: 430)
        ])
    }

    private func bindScene() {
        scene.onStatus = { [weak self] value in self?.statusLabel.stringValue = value }
        scene.onPauseRequest = { [weak self] in self?.showPause() }
        scene.onGameOver = { [weak self] score, wave in
            self?.showGameOver(score: score, wave: wave)
        }
    }

    private func label(
        _ value: String,
        size: CGFloat,
        color: NSColor,
        weight: NSFont.Weight,
        mono: Bool = false
    ) -> NSTextField {
        let field = NSTextField(labelWithString: value)
        field.translatesAutoresizingMaskIntoConstraints = false
        field.font = mono
            ? .monospacedSystemFont(ofSize: size, weight: weight)
            : .systemFont(ofSize: size, weight: weight)
        field.textColor = color
        return field
    }

    private func symbolButton(_ symbol: String, label: String, action: Selector) -> HoverButton {
        let button = HoverButton()
        configureSymbolButton(button, symbol: symbol, label: label, action: action)
        return button
    }

    private func configureSymbolButton(_ button: HoverButton, symbol: String, label: String, action: Selector) {
        button.translatesAutoresizingMaskIntoConstraints = false
        button.title = ""
        button.target = self
        button.action = action
        button.isBordered = false
        button.wantsLayer = true
        button.layer?.cornerRadius = 3
        button.layer?.borderWidth = 1
        button.layer?.borderColor = NSColor(white: 0.66, alpha: 0.18).cgColor
        button.layer?.backgroundColor = button.normalColor.cgColor
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.imagePosition = .imageOnly
        button.contentTintColor = NSColor(white: 0.84, alpha: 1)
        button.toolTip = label
        button.focusRingType = .exterior
        button.widthAnchor.constraint(equalToConstant: 36).isActive = true
        button.heightAnchor.constraint(equalToConstant: 32).isActive = true
    }

    @objc private func selectMissionButton(_ sender: MissionButton) {
        selectMission(sender.mode)
    }

    @objc private func selectPublic() {
        selectedMode = "public"
        missionButtons.forEach { $0.updateSelection(false) }
        objectiveLabel.stringValue = "与公开战区飞行员协同作战"
        pressureLabel.stringValue = "在线模式  ·  需要稳定网络"
        launchButton.title = "进入公开战区"
    }

    private func selectMission(_ mode: String) {
        guard let option = offlineMissions.first(where: { $0.mode == mode }) else { return }
        selectedMode = mode
        missionButtons.forEach { $0.updateSelection($0.mode == mode) }
        objectiveLabel.stringValue = option.objective
        pressureLabel.stringValue = "\(option.pressure)  ·  本机 60 Hz"
        launchButton.title = "启动任务"
    }

    @objc private func startGame() {
        deckOverlay.isHidden = true
        combatUtilities.isHidden = false
        scene.start(
            mode: selectedMode,
            name: pilotName,
            loadout: SFLoadoutProfile(weapon: selectedWeapon, device: selectedDevice, core: selectedCore),
            controls: SFControlProfile.saved()
        )
        view.window?.makeFirstResponder(scene)
    }

    @objc private func showArmory() {
        armorySelector.selectedSegment = selectedWeapon
        deviceSelector.selectedSegment = selectedDevice
        coreSelector.selectedSegment = selectedCore
        deckOverlay.isHidden = true
        armoryOverlay.isHidden = false
        view.window?.makeFirstResponder(armorySelector)
    }

    @objc private func closeArmory() {
        armoryOverlay.isHidden = true
        deckOverlay.isHidden = false
        view.window?.makeFirstResponder(missionButtons.first(where: \.isMissionSelected))
    }

    @objc private func applyArmory() {
        guard armorySelector.selectedSegment >= 0, deviceSelector.selectedSegment >= 0, coreSelector.selectedSegment >= 0 else { return }
        selectedWeapon = min(4, max(0, armorySelector.selectedSegment))
        selectedDevice = min(4, max(0, deviceSelector.selectedSegment))
        selectedCore = min(5, max(0, coreSelector.selectedSegment))
        SFLoadoutProfile(weapon: selectedWeapon, device: selectedDevice, core: selectedCore).save()
        statusLabel.stringValue = "整备完成 · \(loadoutWeapons[selectedWeapon]) / \(loadoutDevices[selectedDevice]) / \(loadoutCores[selectedCore])"
        closeArmory()
    }

    @objc private func showSettings() {
        let profile = SFControlProfile.saved()
        let values = [
            "forward": profile.forwardKey, "backward": profile.backwardKey,
            "left": profile.leftKey, "right": profile.rightKey,
            "fire": profile.fireKey, "camera": profile.cameraKey
        ]
        values.forEach { action, code in
            keySelectors[action]?.selectItem(withTitle: macKeyChoices.first(where: { $0.1 == code })?.0 ?? "W")
        }
        sensitivitySelector.selectedSegment = profile.aimSensitivity < 0.85 ? 0 : (profile.aimSensitivity < 1.2 ? 1 : 2)
        deckOverlay.isHidden = true
        settingsOverlay.isHidden = false
        view.window?.makeFirstResponder(keySelectors["forward"])
    }

    @objc private func closeSettings() {
        settingsOverlay.isHidden = true
        deckOverlay.isHidden = false
        view.window?.makeFirstResponder(missionButtons.first(where: \.isMissionSelected))
    }

    @objc private func applySettings() {
        func code(_ action: String, fallback: UInt16) -> UInt16 {
            guard let title = keySelectors[action]?.titleOfSelectedItem else { return fallback }
            return macKeyChoices.first(where: { $0.0 == title })?.1 ?? fallback
        }
        var profile = SFControlProfile.saved()
        profile.forwardKey = code("forward", fallback: 13)
        profile.backwardKey = code("backward", fallback: 1)
        profile.leftKey = code("left", fallback: 0)
        profile.rightKey = code("right", fallback: 2)
        profile.fireKey = code("fire", fallback: 49)
        profile.cameraKey = code("camera", fallback: 9)
        profile.aimSensitivity = sensitivitySelector.selectedSegment == 0 ? 0.75 : (sensitivitySelector.selectedSegment == 2 ? 1.35 : 1)
        profile.save()
        statusLabel.stringValue = "控制方案已保存 · 键位与鼠标灵敏度已更新"
        closeSettings()
    }

    @objc private func returnToLaunch() {
        scene.stop()
        combatUtilities.isHidden = true
        armoryOverlay.isHidden = true
        settingsOverlay.isHidden = true
        deckOverlay.isHidden = false
        statusLabel.stringValue = "离线可用 · 本机任务已就绪"
        view.window?.makeFirstResponder(missionButtons.first(where: \.isMissionSelected))
    }

    @objc private func toggleCamera() {
        scene.toggleCamera()
        view.window?.makeFirstResponder(scene)
    }

    @objc private func showPause() {
        guard deckOverlay.isHidden else { return }
        scene.setPaused(true)
        let alert = NSAlert()
        alert.messageText = "行动暂停"
        alert.informativeText = "WASD 移动 · 鼠标按住瞄准开火 · 1–5 切换武器 · V 切换视角"
        alert.addButton(withTitle: "继续行动")
        alert.addButton(withTitle: "返回战备台")
        if alert.runModal() == .alertFirstButtonReturn {
            scene.setPaused(false)
            view.window?.makeFirstResponder(scene)
        } else {
            returnToLaunch()
        }
    }

    private func showGameOver(score: Int, wave: Int) {
        let alert = NSAlert()
        let outcome = statusLabel.stringValue
        let missionTitle = offlineMissions.first(where: { $0.mode == selectedMode })?.title ?? "公开协作"
        alert.messageText = outcome.hasPrefix("任务完成") ? "任务完成" : "任务结算"
        alert.informativeText = "\(missionTitle)\n\(outcome)\n得分 \(String(format: "%07d", score)) · 波次 \(String(format: "%02d", wave))"
        alert.addButton(withTitle: "再次出击")
        alert.addButton(withTitle: "返回战备台")
        if alert.runModal() == .alertFirstButtonReturn {
            startGame()
        } else {
            returnToLaunch()
        }
    }

    @objc private func showLogin() {
        let alert = NSAlert()
        alert.messageText = "铮铮通行证"
        alert.informativeText = "在 App 内直接登录，不会打开网页。"
        alert.addButton(withTitle: "登录")
        alert.addButton(withTitle: "取消")
        let fields = NSStackView()
        fields.orientation = .vertical
        fields.spacing = 8
        let account = NSTextField()
        account.placeholderString = "用户名 / 邮箱 / 手机号"
        let password = NSSecureTextField()
        password.placeholderString = "密码"
        fields.addArrangedSubview(account)
        fields.addArrangedSubview(password)
        fields.frame = NSRect(x: 0, y: 0, width: 330, height: 58)
        alert.accessoryView = fields
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let username = account.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty, !password.stringValue.isEmpty else { return }
        login(username: username, password: password.stringValue)
    }

    private func login(username: String, password: String) {
        var request = URLRequest(url: passportURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // 通行证接口用这个头识别原生客户端：App 里没有 Turnstile 小组件，
        // 不带该头会被判成「安全验证无效」而返回 400。
        request.setValue("spacefight-macos", forHTTPHeaderField: "X-Passport-Client")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        statusLabel.stringValue = "正在登录通行证"
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self else { return }
            let payload = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let user = payload?["user"] as? [String: Any]
            let success = payload?["success"] as? Bool ?? false
            let display = (user?["nickname"] as? String)?.nilIfEmpty
                ?? (user?["username"] as? String)?.nilIfEmpty
                ?? username
            DispatchQueue.main.async {
                if success {
                    UserDefaults.standard.set(display, forKey: "spacefight.displayName")
                    UserDefaults.standard.set(user?["uid"] as? String ?? "", forKey: "spacefight.uid")
                    self.statusLabel.stringValue = "已登录 · \(display)"
                } else {
                    self.statusLabel.stringValue = error == nil
                        ? (payload?["error"] as? String ?? "登录失败")
                        : "网络不可用 · 离线任务仍可启动"
                }
            }
        }.resume()
    }

    @objc private func showProfile() {
        let alert = NSAlert()
        alert.messageText = "我的 SpaceFight"
        alert.informativeText = "\(pilotName == "Player" ? "未登录通行证" : "飞行员：\(pilotName)")\n版本 \(appVersion) · build \(appBuild)\n包名 cn.zhengzhengstudio.spacefight"
        alert.addButton(withTitle: pilotName == "Player" ? "登录" : "切换账号")
        alert.addButton(withTitle: "检查更新")
        alert.addButton(withTitle: "关闭")
        switch alert.runModal() {
        case .alertFirstButtonReturn: showLogin()
        case .alertSecondButtonReturn: checkUpdates(manual: true)
        default: break
        }
    }

    @objc private func manualUpdate() { checkUpdates(manual: true) }

    private func checkUpdates(manual: Bool) {
        var request = URLRequest(url: manifestURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        URLSession.shared.dataTask(with: request) { data, _, error in
            let root = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let item = (root?["apps"] as? [[String: Any]])?.first { ($0["id"] as? String) == updateId }
            let remoteBuild = item?["build"] as? Int ?? 0
            let version = item?["version"] as? String ?? ""
            let raw = item?["downloadURL"] as? String ?? ""
            let download = raw.hasPrefix("/") ? "https://zhengzhengstudio.cn\(raw)" : raw
            DispatchQueue.main.async {
                if isRemoteReleaseNewer(version: version, build: remoteBuild), let url = URL(string: download) {
                    let alert = NSAlert()
                    alert.messageText = "发现新版本 \(version)"
                    alert.informativeText = "当前 \(appVersion)，更新后可继续使用原账号。"
                    alert.addButton(withTitle: "下载更新")
                    alert.addButton(withTitle: "稍后")
                    if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(url) }
                } else if manual {
                    let alert = NSAlert()
                    alert.messageText = error == nil ? "无需更新" : "更新检查失败"
                    alert.informativeText = error == nil
                        ? "当前已是最新版本。"
                        : "暂时无法连接更新服务，离线任务不受影响。"
                    alert.addButton(withTitle: "好")
                    alert.runModal()
                }
            }
        }.resume()
    }

    private var pilotName: String {
        UserDefaults.standard.string(forKey: "spacefight.displayName") ?? "Player"
    }

    private var amber: NSColor {
        NSColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 1)
    }

    deinit { scene.stop() }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
withExtendedLifetime(delegate) {
    app.run()
}
