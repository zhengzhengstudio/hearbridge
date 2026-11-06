import UIKit
import SpriteKit

private let appVersion = "0.12.0"
private let appBuild = 63
private let updateId = "spacefight-ios"
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

private struct MissionOption {
    let mode: String
    let code: String
    let title: String
    let objective: String
    let pressure: String
}

private let offlineMissions = [
    MissionOption(mode: "survival", code: "01", title: "生存巡航", objective: "抵御无限升级敌潮并刷新纪录", pressure: "预计压力  中"),
    MissionOption(mode: "boss", code: "02", title: "首领截击", objective: "摧毁三个组件后击穿首领核心", pressure: "预计压力  高"),
    MissionOption(mode: "escort", code: "03", title: "运输护航", objective: "保护运输舰穿越峡谷航线", pressure: "预计压力  高"),
    MissionOption(mode: "defense", code: "04", title: "据点争夺", objective: "夺取控制点并阻止敌军反扑", pressure: "预计压力  中高"),
    MissionOption(mode: "timed", code: "05", title: "限时歼灭", objective: "通过连续击毁延长倒计时", pressure: "预计压力  极高"),
    MissionOption(mode: "raid", code: "06", title: "资源突袭", objective: "回收八份资源并及时撤离", pressure: "预计压力  高")
]

final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = SpaceFightViewController()
        window?.makeKeyAndVisible()
        return true
    }
}

private final class MissionButton: UIButton {
    let mode: String

    init(option: MissionOption) {
        mode = option.mode
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        contentHorizontalAlignment = .leading
        heightAnchor.constraint(greaterThanOrEqualToConstant: 58).isActive = true
        accessibilityLabel = "\(option.title)，\(option.objective)"
        var style = UIButton.Configuration.plain()
        style.title = "\(option.code)   \(option.title)"
        style.subtitle = option.objective
        style.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .monospacedSystemFont(ofSize: 13, weight: .bold)
            return outgoing
        }
        style.subtitleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = .systemFont(ofSize: 10, weight: .medium)
            return outgoing
        }
        style.titleLineBreakMode = .byTruncatingTail
        style.subtitleLineBreakMode = .byTruncatingTail
        style.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 10)
        style.background.cornerRadius = 3
        configuration = style
        layer.borderWidth = 1
        layer.cornerRadius = 3
        updateSelection(false)
    }

    required init?(coder: NSCoder) { nil }

    func updateSelection(_ selected: Bool) {
        var style = configuration
        style?.baseForegroundColor = selected
            ? UIColor(white: 0.96, alpha: 1)
            : UIColor(white: 0.68, alpha: 1)
        style?.background.backgroundColor = selected
            ? UIColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.14)
            : UIColor(red: 0.025, green: 0.035, blue: 0.044, alpha: 0.72)
        configuration = style
        layer.borderColor = selected
            ? UIColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 0.88).cgColor
            : UIColor(white: 0.62, alpha: 0.2).cgColor
    }
}

final class SpaceFightViewController: UIViewController {
    private let gameView = SKView()
    private let scene = NativeGameScene()
    private let deckOverlay = UIView()
    private let armoryOverlay = UIView()
    private let settingsOverlay = UIView()
    private let statusLabel = UILabel()
    private let objectiveLabel = UILabel()
    private let pressureLabel = UILabel()
    private let loginButton = UIButton(type: .system)
    private let launchButton = UIButton(type: .system)
    private let combatUtilities = UIStackView()
    private var cameraButton: UIButton!
    private var missionButtons: [MissionButton] = []
    private var armoryButtons: [UIButton] = []
    private var deviceButtons: [UIButton] = []
    private var coreButtons: [UIButton] = []
    private var settingsButtons: [UIButton] = []
    private var selectedMode = "survival"
    private var selectedWeapon = min(4, max(0, UserDefaults.standard.integer(forKey: "spacefight.startingWeapon")))
    private var selectedDevice = min(4, max(0, UserDefaults.standard.integer(forKey: "spacefight.tacticalDevice")))
    private var selectedCore = min(5, max(0, UserDefaults.standard.integer(forKey: "spacefight.frameCore")))
    private var armoryDraft = 0
    private var deviceDraft = 0
    private var coreDraft = 0
    private var controlDraft = SFControlProfile.saved()
    private var paused = false
    private var latestSceneStatus = ""

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.018, green: 0.024, blue: 0.03, alpha: 1)
        buildInterface()
        bindScene()
        selectMission("survival")
        statusLabel.text = "离线可用 · 本机任务已就绪"
        checkUpdates(manual: false)
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    private func buildInterface() {
        gameView.translatesAutoresizingMaskIntoConstraints = false
        gameView.ignoresSiblingOrder = true
        gameView.preferredFramesPerSecond = 60
        gameView.presentScene(scene)
        view.addSubview(gameView)

        deckOverlay.translatesAutoresizingMaskIntoConstraints = false
        deckOverlay.backgroundColor = .clear
        view.addSubview(deckOverlay)

        let topBar = UIView()
        topBar.translatesAutoresizingMaskIntoConstraints = false
        topBar.backgroundColor = UIColor(red: 0.018, green: 0.026, blue: 0.033, alpha: 0.9)
        deckOverlay.addSubview(topBar)

        let mark = UIView()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.backgroundColor = amber
        topBar.addSubview(mark)

        let title = label("SPACEFIGHT", size: 17, weight: .black, color: UIColor(white: 0.96, alpha: 1))
        title.font = .monospacedSystemFont(ofSize: 17, weight: .black)
        topBar.addSubview(title)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
        statusLabel.textColor = UIColor(white: 0.62, alpha: 1)
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        topBar.addSubview(statusLabel)

        let profile = symbolButton("person.crop.circle", name: "我的资料", action: #selector(showProfile))
        let update = symbolButton("arrow.triangle.2.circlepath", name: "检查更新", action: #selector(manualUpdate))
        loginButton.setImage(UIImage(systemName: "person.badge.key"), for: .normal)
        loginButton.accessibilityLabel = "通行证登录"
        loginButton.tintColor = UIColor(white: 0.82, alpha: 1)
        loginButton.addTarget(self, action: #selector(showLogin), for: .touchUpInside)
        loginButton.widthAnchor.constraint(equalToConstant: 44).isActive = true
        loginButton.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let armory = symbolButton("wrench.and.screwdriver", name: "战备整备台", action: #selector(showArmory))
        let settings = symbolButton("slider.horizontal.3", name: "控制中心", action: #selector(showSettings))
        let utilities = UIStackView(arrangedSubviews: [loginButton, armory, settings, profile, update])
        utilities.translatesAutoresizingMaskIntoConstraints = false
        utilities.axis = .horizontal
        utilities.spacing = 2
        topBar.addSubview(utilities)

        let missionScroll = UIScrollView()
        missionScroll.translatesAutoresizingMaskIntoConstraints = false
        missionScroll.alwaysBounceVertical = true
        missionScroll.showsVerticalScrollIndicator = true
        missionScroll.indicatorStyle = .white
        missionScroll.contentInsetAdjustmentBehavior = .never
        deckOverlay.addSubview(missionScroll)

        let rail = UIStackView()
        rail.translatesAutoresizingMaskIntoConstraints = false
        rail.axis = .vertical
        rail.spacing = 7
        rail.alignment = .fill
        missionScroll.addSubview(rail)

        let kicker = label("LOCAL MISSIONS / 60 HZ", size: 10, weight: .bold, color: amber)
        kicker.font = .monospacedSystemFont(ofSize: 10, weight: .bold)
        rail.addArrangedSubview(kicker)
        let controls = label("左侧移动 · 右侧瞄准开火 · 底部切换武器", size: 10, weight: .semibold, color: UIColor(white: 0.76, alpha: 1))
        controls.numberOfLines = 2
        rail.addArrangedSubview(controls)
        for option in offlineMissions {
            let button = MissionButton(option: option)
            button.addTarget(self, action: #selector(selectMissionButton(_:)), for: .touchUpInside)
            missionButtons.append(button)
            rail.addArrangedSubview(button)
        }

        let onlineRule = UIView()
        onlineRule.translatesAutoresizingMaskIntoConstraints = false
        onlineRule.backgroundColor = UIColor(white: 0.65, alpha: 0.18)
        onlineRule.heightAnchor.constraint(equalToConstant: 1).isActive = true
        rail.setCustomSpacing(11, after: missionButtons.last!)
        rail.addArrangedSubview(onlineRule)

        let publicButton = UIButton(type: .system)
        var publicStyle = UIButton.Configuration.plain()
        publicStyle.image = UIImage(systemName: "network")
        publicStyle.imagePadding = 8
        publicStyle.title = "公开协作"
        publicStyle.subtitle = "次级在线模式 · 需要网络"
        publicStyle.baseForegroundColor = UIColor(white: 0.66, alpha: 1)
        publicStyle.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 10, bottom: 7, trailing: 10)
        publicStyle.background.cornerRadius = 3
        publicStyle.background.strokeColor = UIColor(white: 0.62, alpha: 0.18)
        publicStyle.background.strokeWidth = 1
        publicButton.configuration = publicStyle
        publicButton.contentHorizontalAlignment = .leading
        publicButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 50).isActive = true
        publicButton.accessibilityLabel = "公开协作，次级在线模式，需要网络"
        publicButton.addTarget(self, action: #selector(selectPublic), for: .touchUpInside)
        rail.addArrangedSubview(publicButton)

        let missionReadout = UIView()
        missionReadout.translatesAutoresizingMaskIntoConstraints = false
        missionReadout.backgroundColor = UIColor(red: 0.018, green: 0.026, blue: 0.033, alpha: 0.72)
        missionReadout.layer.borderColor = UIColor(white: 0.7, alpha: 0.16).cgColor
        missionReadout.layer.borderWidth = 1
        deckOverlay.addSubview(missionReadout)

        let ready = label("INTERCEPTOR / READY", size: 10, weight: .bold, color: amber)
        ready.font = .monospacedSystemFont(ofSize: 10, weight: .bold)
        missionReadout.addSubview(ready)
        objectiveLabel.translatesAutoresizingMaskIntoConstraints = false
        objectiveLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        objectiveLabel.textColor = UIColor(white: 0.9, alpha: 1)
        objectiveLabel.numberOfLines = 2
        missionReadout.addSubview(objectiveLabel)
        pressureLabel.translatesAutoresizingMaskIntoConstraints = false
        pressureLabel.font = .monospacedSystemFont(ofSize: 10, weight: .medium)
        pressureLabel.textColor = UIColor(white: 0.6, alpha: 1)
        missionReadout.addSubview(pressureLabel)

        var launchStyle = UIButton.Configuration.filled()
        launchStyle.image = UIImage(systemName: "arrow.up.right")
        launchStyle.imagePlacement = .trailing
        launchStyle.imagePadding = 10
        launchStyle.title = "启动任务"
        launchStyle.baseBackgroundColor = amber
        launchStyle.baseForegroundColor = UIColor(red: 0.07, green: 0.075, blue: 0.08, alpha: 1)
        launchStyle.cornerStyle = .small
        launchButton.translatesAutoresizingMaskIntoConstraints = false
        launchButton.configuration = launchStyle
        launchButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        launchButton.accessibilityLabel = "启动已选任务"
        launchButton.addTarget(self, action: #selector(startGame), for: .touchUpInside)
        deckOverlay.addSubview(launchButton)

        let pause = symbolButton("pause.fill", name: "暂停", action: #selector(showPause))
        cameraButton = symbolButton("camera.rotate", name: "切换驾驶舱与追尾视角", action: #selector(toggleCamera))
        cameraButton.accessibilityValue = "追尾视角"
        let back = symbolButton("chevron.backward", name: "返回战备台", action: #selector(returnToLaunch))
        combatUtilities.translatesAutoresizingMaskIntoConstraints = false
        combatUtilities.axis = .horizontal
        combatUtilities.spacing = 4
        combatUtilities.addArrangedSubview(back)
        combatUtilities.addArrangedSubview(cameraButton)
        combatUtilities.addArrangedSubview(pause)
        combatUtilities.isHidden = true
        view.addSubview(combatUtilities)

        let deckWidth = missionScroll.widthAnchor.constraint(
            equalTo: view.safeAreaLayoutGuide.widthAnchor,
            multiplier: 0.42
        )
        deckWidth.priority = .defaultHigh
        let readoutWidth = missionReadout.widthAnchor.constraint(
            equalTo: view.safeAreaLayoutGuide.widthAnchor,
            multiplier: 0.36
        )
        readoutWidth.priority = .defaultHigh

        NSLayoutConstraint.activate([
            gameView.topAnchor.constraint(equalTo: view.topAnchor),
            gameView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            gameView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            gameView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            deckOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            deckOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            deckOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            deckOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            topBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 52),
            mark.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 18),
            mark.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            mark.widthAnchor.constraint(equalToConstant: 4),
            mark.heightAnchor.constraint(equalToConstant: 28),
            title.leadingAnchor.constraint(equalTo: mark.trailingAnchor, constant: 10),
            title.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 15),
            statusLabel.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            utilities.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -10),
            utilities.centerYAnchor.constraint(equalTo: topBar.centerYAnchor),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: utilities.leadingAnchor, constant: -10),

            missionScroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            missionScroll.topAnchor.constraint(equalTo: topBar.bottomAnchor, constant: 10),
            missionScroll.bottomAnchor.constraint(equalTo: launchButton.topAnchor, constant: -10),
            deckWidth,
            missionScroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 250),
            missionScroll.widthAnchor.constraint(lessThanOrEqualToConstant: 360),

            rail.leadingAnchor.constraint(equalTo: missionScroll.contentLayoutGuide.leadingAnchor),
            rail.trailingAnchor.constraint(equalTo: missionScroll.contentLayoutGuide.trailingAnchor, constant: -5),
            rail.topAnchor.constraint(equalTo: missionScroll.contentLayoutGuide.topAnchor),
            rail.bottomAnchor.constraint(equalTo: missionScroll.contentLayoutGuide.bottomAnchor, constant: -8),
            rail.widthAnchor.constraint(equalTo: missionScroll.frameLayoutGuide.widthAnchor, constant: -5),

            launchButton.leadingAnchor.constraint(equalTo: missionScroll.leadingAnchor),
            launchButton.trailingAnchor.constraint(equalTo: missionScroll.trailingAnchor),
            launchButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
            launchButton.heightAnchor.constraint(equalToConstant: 50),

            missionReadout.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            missionReadout.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10),
            readoutWidth,
            missionReadout.widthAnchor.constraint(greaterThanOrEqualToConstant: 205),
            missionReadout.widthAnchor.constraint(lessThanOrEqualToConstant: 282),
            missionReadout.heightAnchor.constraint(equalToConstant: 88),
            ready.leadingAnchor.constraint(equalTo: missionReadout.leadingAnchor, constant: 12),
            ready.topAnchor.constraint(equalTo: missionReadout.topAnchor, constant: 9),
            objectiveLabel.leadingAnchor.constraint(equalTo: ready.leadingAnchor),
            objectiveLabel.trailingAnchor.constraint(equalTo: missionReadout.trailingAnchor, constant: -10),
            objectiveLabel.topAnchor.constraint(equalTo: ready.bottomAnchor, constant: 5),
            pressureLabel.leadingAnchor.constraint(equalTo: ready.leadingAnchor),
            pressureLabel.topAnchor.constraint(equalTo: objectiveLabel.bottomAnchor, constant: 3),

            combatUtilities.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            combatUtilities.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -10)
        ])
        buildArmoryOverlay()
        buildSettingsOverlay()
    }

    private func buildArmoryOverlay() {
        armoryOverlay.translatesAutoresizingMaskIntoConstraints = false
        armoryOverlay.backgroundColor = UIColor(red: 0.018, green: 0.026, blue: 0.032, alpha: 0.98)
        armoryOverlay.isHidden = true
        view.addSubview(armoryOverlay)

        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.backgroundColor = UIColor(red: 0.022, green: 0.031, blue: 0.038, alpha: 1)
        header.layer.borderColor = UIColor(white: 0.68, alpha: 0.2).cgColor
        header.layer.borderWidth = 1
        armoryOverlay.addSubview(header)

        let back = UIButton(type: .system)
        back.translatesAutoresizingMaskIntoConstraints = false
        var backStyle = UIButton.Configuration.bordered()
        backStyle.title = "返回机库"
        backStyle.baseForegroundColor = UIColor(white: 0.82, alpha: 1)
        backStyle.background.cornerRadius = 2
        backStyle.background.strokeColor = UIColor(white: 0.68, alpha: 0.32)
        back.configuration = backStyle
        back.addTarget(self, action: #selector(closeArmory), for: .touchUpInside)
        header.addSubview(back)

        let title = label("战备整备台", size: 22, weight: .black, color: UIColor(white: 0.96, alpha: 1))
        header.addSubview(title)
        let state = label("LOCAL / SF-09", size: 10, weight: .bold, color: amber)
        state.font = .monospacedSystemFont(ofSize: 10, weight: .bold)
        header.addSubview(state)

        let preview = UIView()
        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.backgroundColor = UIColor(red: 0.025, green: 0.037, blue: 0.045, alpha: 0.82)
        preview.layer.borderColor = UIColor(white: 0.66, alpha: 0.22).cgColor
        preview.layer.borderWidth = 1
        armoryOverlay.addSubview(preview)

        let coordinate = label("HARDPOINT 01                     FRAME READY", size: 9, weight: .bold, color: UIColor(white: 0.58, alpha: 1))
        coordinate.font = .monospacedSystemFont(ofSize: 9, weight: .bold)
        preview.addSubview(coordinate)
        let shipImage = UIImageView(image: UIImage(named: "ships/interceptor") ?? UIImage(named: "interceptor"))
        shipImage.translatesAutoresizingMaskIntoConstraints = false
        shipImage.contentMode = .scaleAspectFit
        shipImage.alpha = 0.94
        shipImage.accessibilityLabel = "SF-09 截击机"
        preview.addSubview(shipImage)
        let frameReadout = label("SF-09   装甲 100   护盾 80   五武器位", size: 11, weight: .bold, color: UIColor(white: 0.9, alpha: 1))
        frameReadout.font = .monospacedSystemFont(ofSize: 11, weight: .bold)
        frameReadout.textAlignment = .center
        frameReadout.backgroundColor = UIColor(red: 0.02, green: 0.03, blue: 0.036, alpha: 0.9)
        preview.addSubview(frameReadout)

        let bank = UIStackView()
        bank.translatesAutoresizingMaskIntoConstraints = false
        bank.axis = .vertical
        bank.spacing = 7
        bank.distribution = .fill
        armoryOverlay.addSubview(bank)

        func selectorRow(title: String, names: [String], offset: Int, target: inout [UIButton]) {
            let heading = label(title, size: 11, weight: .bold, color: amber)
            heading.font = .monospacedSystemFont(ofSize: 11, weight: .bold)
            heading.heightAnchor.constraint(equalToConstant: 18).isActive = true
            bank.addArrangedSubview(heading)
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 4
            row.distribution = .fillEqually
            row.heightAnchor.constraint(equalToConstant: 46).isActive = true
            target.removeAll()
            for index in names.indices {
                let button = UIButton(type: .system)
                button.tag = offset + index
                button.titleLabel?.font = .systemFont(ofSize: 10, weight: .bold)
                button.titleLabel?.numberOfLines = 2
                button.titleLabel?.textAlignment = .center
                button.layer.cornerRadius = 2
                button.layer.borderWidth = 1
                button.addTarget(self, action: #selector(selectArmoryPart(_:)), for: .touchUpInside)
                target.append(button)
                row.addArrangedSubview(button)
            }
            bank.addArrangedSubview(row)
        }
        selectorRow(title: "01  主武器", names: loadoutWeapons, offset: 0, target: &armoryButtons)
        selectorRow(title: "02  战术设备", names: loadoutDevices, offset: 100, target: &deviceButtons)
        selectorRow(title: "03  机体核心", names: loadoutCores, offset: 200, target: &coreButtons)

        let footer = UIView()
        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.backgroundColor = UIColor(red: 0.022, green: 0.031, blue: 0.038, alpha: 1)
        footer.layer.borderColor = UIColor(white: 0.68, alpha: 0.2).cgColor
        footer.layer.borderWidth = 1
        armoryOverlay.addSubview(footer)
        let hint = label("配置仅作用于本机任务，战斗中仍可切换全部武器", size: 10, weight: .medium, color: UIColor(white: 0.6, alpha: 1))
        footer.addSubview(hint)
        let confirm = UIButton(type: .system)
        confirm.translatesAutoresizingMaskIntoConstraints = false
        var confirmStyle = UIButton.Configuration.filled()
        confirmStyle.title = "确认装配"
        confirmStyle.baseBackgroundColor = amber
        confirmStyle.baseForegroundColor = UIColor(red: 0.07, green: 0.075, blue: 0.08, alpha: 1)
        confirmStyle.background.cornerRadius = 2
        confirm.configuration = confirmStyle
        confirm.addTarget(self, action: #selector(applyArmory), for: .touchUpInside)
        footer.addSubview(confirm)

        NSLayoutConstraint.activate([
            armoryOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            armoryOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            armoryOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            armoryOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 54),
            back.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 14),
            back.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            back.widthAnchor.constraint(equalToConstant: 102),
            back.heightAnchor.constraint(equalToConstant: 36),
            title.leadingAnchor.constraint(equalTo: back.trailingAnchor, constant: 16),
            title.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            state.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            state.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 58),
            hint.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            hint.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            confirm.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            confirm.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            confirm.widthAnchor.constraint(equalToConstant: 168),
            confirm.heightAnchor.constraint(equalToConstant: 42),
            hint.trailingAnchor.constraint(lessThanOrEqualTo: confirm.leadingAnchor, constant: -12),
            preview.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            preview.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
            preview.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -12),
            preview.widthAnchor.constraint(equalTo: view.safeAreaLayoutGuide.widthAnchor, multiplier: 0.43),
            bank.leadingAnchor.constraint(equalTo: preview.trailingAnchor, constant: 12),
            bank.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            bank.topAnchor.constraint(equalTo: preview.topAnchor),
            bank.bottomAnchor.constraint(equalTo: preview.bottomAnchor),
            coordinate.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 12),
            coordinate.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -12),
            coordinate.topAnchor.constraint(equalTo: preview.topAnchor, constant: 10),
            shipImage.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 14),
            shipImage.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -14),
            shipImage.topAnchor.constraint(equalTo: coordinate.bottomAnchor, constant: 4),
            shipImage.bottomAnchor.constraint(equalTo: frameReadout.topAnchor, constant: -4),
            frameReadout.leadingAnchor.constraint(equalTo: preview.leadingAnchor),
            frameReadout.trailingAnchor.constraint(equalTo: preview.trailingAnchor),
            frameReadout.bottomAnchor.constraint(equalTo: preview.bottomAnchor),
            frameReadout.heightAnchor.constraint(equalToConstant: 42)
        ])
    }

    private func buildSettingsOverlay() {
        settingsOverlay.translatesAutoresizingMaskIntoConstraints = false
        settingsOverlay.backgroundColor = UIColor(red: 0.018, green: 0.026, blue: 0.032, alpha: 0.98)
        settingsOverlay.isHidden = true
        view.addSubview(settingsOverlay)

        let panel = UIStackView()
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.axis = .vertical
        panel.spacing = 10
        panel.layoutMargins = UIEdgeInsets(top: 20, left: 22, bottom: 20, right: 22)
        panel.isLayoutMarginsRelativeArrangement = true
        panel.backgroundColor = UIColor(red: 0.035, green: 0.052, blue: 0.064, alpha: 0.96)
        panel.layer.borderWidth = 1
        panel.layer.borderColor = UIColor(white: 0.7, alpha: 0.24).cgColor
        settingsOverlay.addSubview(panel)

        let title = label("控制中心", size: 24, weight: .black, color: UIColor(white: 0.96, alpha: 1))
        panel.addArrangedSubview(title)
        let copy = label("移动、瞄准与开火独立输入；设置保存在本机。", size: 11, weight: .medium, color: UIColor(white: 0.68, alpha: 1))
        panel.addArrangedSubview(copy)
        settingsButtons.removeAll()
        for index in 0..<2 {
            let button = UIButton(type: .system)
            button.tag = index
            button.heightAnchor.constraint(equalToConstant: 48).isActive = true
            button.titleLabel?.font = .systemFont(ofSize: 13, weight: .bold)
            button.layer.borderWidth = 1
            button.layer.cornerRadius = 2
            button.addTarget(self, action: #selector(cycleTouchSetting(_:)), for: .touchUpInside)
            settingsButtons.append(button)
            panel.addArrangedSubview(button)
        }
        let controller = label("外接控制器可与触控同时使用；战斗内相机键切换第一/第三人称。", size: 10, weight: .medium, color: UIColor(white: 0.62, alpha: 1))
        controller.numberOfLines = 2
        panel.addArrangedSubview(controller)
        let actions = UIStackView()
        actions.axis = .horizontal
        actions.spacing = 8
        actions.distribution = .fillEqually
        let cancel = UIButton(type: .system)
        cancel.setTitle("返回机库", for: .normal)
        cancel.addTarget(self, action: #selector(closeSettings), for: .touchUpInside)
        let save = UIButton(type: .system)
        save.setTitle("保存控制方案", for: .normal)
        save.backgroundColor = amber
        save.setTitleColor(UIColor(red: 0.07, green: 0.075, blue: 0.08, alpha: 1), for: .normal)
        save.addTarget(self, action: #selector(applySettings), for: .touchUpInside)
        [cancel, save].forEach {
            $0.heightAnchor.constraint(equalToConstant: 46).isActive = true
            $0.layer.cornerRadius = 2
            $0.layer.borderWidth = 1
            $0.layer.borderColor = UIColor(white: 0.7, alpha: 0.28).cgColor
            actions.addArrangedSubview($0)
        }
        panel.addArrangedSubview(actions)
        NSLayoutConstraint.activate([
            settingsOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            settingsOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            settingsOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            settingsOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            panel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            panel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            panel.widthAnchor.constraint(equalTo: view.safeAreaLayoutGuide.widthAnchor, multiplier: 0.62),
            panel.widthAnchor.constraint(lessThanOrEqualToConstant: 560)
        ])
    }

    private func bindScene() {
        scene.onStatus = { [weak self] value in
            self?.latestSceneStatus = value
            self?.statusLabel.text = value
        }
        scene.onPauseRequest = { [weak self] in self?.showPause() }
        scene.onGameOver = { [weak self] score, wave in
            self?.showGameOver(score: score, wave: wave, status: self?.latestSceneStatus ?? "")
        }
    }

    private func label(_ value: String, size: CGFloat, weight: UIFont.Weight, color: UIColor) -> UILabel {
        let result = UILabel()
        result.translatesAutoresizingMaskIntoConstraints = false
        result.text = value
        result.font = .systemFont(ofSize: size, weight: weight)
        result.textColor = color
        return result
    }

    private func symbolButton(_ symbol: String, name: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = UIColor(white: 0.84, alpha: 1)
        button.backgroundColor = UIColor(red: 0.04, green: 0.055, blue: 0.067, alpha: 0.82)
        button.layer.borderColor = UIColor(white: 0.66, alpha: 0.18).cgColor
        button.layer.borderWidth = 1
        button.layer.cornerRadius = 3
        button.accessibilityLabel = name
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    @objc private func selectMissionButton(_ sender: MissionButton) {
        selectMission(sender.mode)
    }

    @objc private func selectPublic() {
        selectedMode = "public"
        missionButtons.forEach { $0.updateSelection(false) }
        objectiveLabel.text = "与公开战区飞行员协同作战"
        pressureLabel.text = "在线模式  ·  需要稳定网络"
        launchButton.configuration?.title = "进入公开战区"
    }

    private func selectMission(_ mode: String) {
        guard let option = offlineMissions.first(where: { $0.mode == mode }) else { return }
        selectedMode = mode
        missionButtons.forEach { $0.updateSelection($0.mode == mode) }
        objectiveLabel.text = option.objective
        pressureLabel.text = "\(option.pressure)  ·  本机 60 Hz"
        launchButton.configuration?.title = "启动任务"
    }

    @objc private func startGame() {
        paused = false
        latestSceneStatus = ""
        deckOverlay.isHidden = true
        combatUtilities.isHidden = false
        scene.start(
            mode: selectedMode,
            name: pilotName,
            loadout: SFLoadoutProfile(weapon: selectedWeapon, device: selectedDevice, core: selectedCore),
            controls: SFControlProfile.saved()
        )
    }

    @objc private func returnToLaunch() {
        scene.stop()
        paused = false
        combatUtilities.isHidden = true
        armoryOverlay.isHidden = true
        settingsOverlay.isHidden = true
        deckOverlay.isHidden = false
        statusLabel.text = "离线可用 · 本机任务已就绪"
    }

    @objc private func toggleCamera() {
        let mode = scene.toggleCamera()
        let label = mode == .cockpit ? "驾驶舱视角" : "追尾视角"
        cameraButton.accessibilityValue = label
        latestSceneStatus = label
        statusLabel.text = label
    }

    @objc private func showPause() {
        guard deckOverlay.isHidden else { return }
        paused = true
        scene.setPaused(true)
        let alert = UIAlertController(
            title: "行动暂停",
            message: "移动、瞄准与开火相互独立 · 底部切换武器",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "继续行动", style: .default) { [weak self] _ in
            self?.paused = false
            self?.scene.setPaused(false)
        })
        alert.addAction(UIAlertAction(title: "返回战备台", style: .destructive) { [weak self] _ in
            self?.returnToLaunch()
        })
        present(alert, animated: true)
    }

    private func showGameOver(score: Int, wave: Int, status: String) {
        let title: String
        if status.contains("任务完成") {
            title = "任务完成"
        } else if status.contains("任务失败") || status.contains("舰体失效") {
            title = "任务失败"
        } else {
            title = "任务结算"
        }
        let result = status.isEmpty ? "任务数据已完成结算" : status
        let alert = UIAlertController(
            title: title,
            message: "\(result)\n得分 \(String(format: "%07d", score))\n抵达波次 \(String(format: "%02d", wave))",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "再次出击", style: .default) { [weak self] _ in self?.startGame() })
        alert.addAction(UIAlertAction(title: "返回战备台", style: .cancel) { [weak self] _ in self?.returnToLaunch() })
        present(alert, animated: true)
    }

    @objc private func showLogin() {
        let alert = UIAlertController(title: "铮铮通行证", message: "在 App 内直接登录，不会打开网页。", preferredStyle: .alert)
        alert.addTextField { field in
            field.placeholder = "用户名 / 邮箱 / 手机号"
            field.textContentType = .username
            field.autocapitalizationType = .none
        }
        alert.addTextField { field in
            field.placeholder = "密码"
            field.textContentType = .password
            field.isSecureTextEntry = true
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "登录", style: .default) { [weak self, weak alert] _ in
            guard
                let self,
                let username = alert?.textFields?[0].text?.trimmingCharacters(in: .whitespacesAndNewlines),
                let password = alert?.textFields?[1].text,
                !username.isEmpty,
                !password.isEmpty
            else { return }
            self.login(username: username, password: password)
        })
        present(alert, animated: true)
    }

    @objc private func showArmory() {
        armoryDraft = selectedWeapon
        deviceDraft = selectedDevice
        coreDraft = selectedCore
        updateArmorySelection()
        deckOverlay.isHidden = true
        armoryOverlay.isHidden = false
    }

    @objc private func selectArmoryPart(_ sender: UIButton) {
        if sender.tag >= 200 { coreDraft = min(5, max(0, sender.tag - 200)) }
        else if sender.tag >= 100 { deviceDraft = min(4, max(0, sender.tag - 100)) }
        else { armoryDraft = min(4, max(0, sender.tag)) }
        updateArmorySelection()
    }

    private func updateArmorySelection() {
        armoryButtons.enumerated().forEach { index, button in
            let active = index == armoryDraft
            button.setTitle("W\(index + 1)   \(loadoutWeapons[index])\(active ? "   /   已挂载" : "")", for: .normal)
            button.setTitleColor(active ? UIColor(white: 0.96, alpha: 1) : UIColor(white: 0.7, alpha: 1), for: .normal)
            button.backgroundColor = active
                ? UIColor(red: 0.31, green: 0.21, blue: 0.105, alpha: 0.94)
                : UIColor(red: 0.04, green: 0.055, blue: 0.067, alpha: 0.9)
            button.layer.borderColor = active
                ? amber.cgColor
                : UIColor(white: 0.66, alpha: 0.2).cgColor
            button.accessibilityValue = active ? "已挂载" : "未挂载"
        }
        updateSelector(deviceButtons, names: loadoutDevices, selected: deviceDraft)
        updateSelector(coreButtons, names: loadoutCores, selected: coreDraft)
    }

    private func updateSelector(_ buttons: [UIButton], names: [String], selected: Int) {
        buttons.enumerated().forEach { index, button in
            let active = index == selected
            button.setTitle(names[index], for: .normal)
            button.setTitleColor(active ? UIColor(red: 0.08, green: 0.09, blue: 0.1, alpha: 1) : UIColor(white: 0.76, alpha: 1), for: .normal)
            button.backgroundColor = active ? amber : UIColor(red: 0.04, green: 0.055, blue: 0.067, alpha: 0.9)
            button.layer.borderColor = (active ? amber : UIColor(white: 0.66, alpha: 0.2)).cgColor
        }
    }

    @objc private func closeArmory() {
        armoryOverlay.isHidden = true
        deckOverlay.isHidden = false
    }

    @objc private func applyArmory() {
        selectedWeapon = min(4, max(0, armoryDraft))
        selectedDevice = min(4, max(0, deviceDraft))
        selectedCore = min(5, max(0, coreDraft))
        SFLoadoutProfile(weapon: selectedWeapon, device: selectedDevice, core: selectedCore).save()
        statusLabel.text = "整备完成 · \(loadoutWeapons[selectedWeapon]) / \(loadoutDevices[selectedDevice]) / \(loadoutCores[selectedCore])"
        closeArmory()
    }

    @objc private func showSettings() {
        controlDraft = SFControlProfile.saved()
        updateSettingsSelection()
        deckOverlay.isHidden = true
        settingsOverlay.isHidden = false
    }

    @objc private func closeSettings() {
        settingsOverlay.isHidden = true
        deckOverlay.isHidden = false
    }

    @objc private func cycleTouchSetting(_ sender: UIButton) {
        if sender.tag == 0 {
            controlDraft.leftHanded.toggle()
        } else {
            controlDraft.aimSensitivity = controlDraft.aimSensitivity < 0.85 ? 1 : (controlDraft.aimSensitivity < 1.2 ? 1.35 : 0.75)
        }
        updateSettingsSelection()
    }

    private func updateSettingsSelection() {
        settingsButtons[0].setTitle("触控布局    \(controlDraft.leftHanded ? "左手开火" : "右手开火")", for: .normal)
        let sensitivity = controlDraft.aimSensitivity < 0.85 ? "稳健" : (controlDraft.aimSensitivity < 1.2 ? "标准" : "迅捷")
        settingsButtons[1].setTitle("瞄准灵敏度    \(sensitivity)", for: .normal)
        settingsButtons.forEach {
            $0.setTitleColor(UIColor(white: 0.9, alpha: 1), for: .normal)
            $0.backgroundColor = UIColor(red: 0.05, green: 0.075, blue: 0.09, alpha: 1)
            $0.layer.borderColor = UIColor(white: 0.7, alpha: 0.24).cgColor
        }
    }

    @objc private func applySettings() {
        controlDraft.save()
        statusLabel.text = "控制方案已保存 · \(controlDraft.leftHanded ? "左手开火" : "右手开火")"
        closeSettings()
    }

    private func login(username: String, password: String) {
        var request = URLRequest(url: passportURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // 通行证接口用这个头识别原生客户端：App 里没有 Turnstile 小组件，
        // 不带该头会被判成「安全验证无效」而返回 400。
        request.setValue("spacefight-ios", forHTTPHeaderField: "X-Passport-Client")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        statusLabel.text = "正在登录通行证"
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
                    self.statusLabel.text = "已登录 · \(display)"
                } else {
                    self.statusLabel.text = error == nil ? (payload?["error"] as? String ?? "登录失败") : "网络不可用 · 离线任务仍可启动"
                }
            }
        }.resume()
    }

    @objc private func showProfile() {
        let account = pilotName == "Player" ? "未登录通行证" : "飞行员：\(pilotName)"
        let alert = UIAlertController(
            title: "我的 SpaceFight",
            message: "\(account)\n版本 \(appVersion) · build \(appBuild)\n包名 cn.zhengzhengstudio.spacefight",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: pilotName == "Player" ? "登录" : "切换账号", style: .default) { [weak self] _ in self?.showLogin() })
        alert.addAction(UIAlertAction(title: "检查更新", style: .default) { [weak self] _ in self?.checkUpdates(manual: true) })
        alert.addAction(UIAlertAction(title: "关闭", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func manualUpdate() { checkUpdates(manual: true) }

    private func checkUpdates(manual: Bool) {
        var request = URLRequest(url: manifestURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            guard let self else { return }
            let root = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let item = (root?["apps"] as? [[String: Any]])?.first { ($0["id"] as? String) == updateId }
            let remoteBuild = item?["build"] as? Int ?? 0
            let version = item?["version"] as? String ?? ""
            let raw = item?["downloadURL"] as? String ?? ""
            let download = raw.hasPrefix("/") ? "https://zhengzhengstudio.cn\(raw)" : raw
            DispatchQueue.main.async {
                if isRemoteReleaseNewer(version: version, build: remoteBuild), let url = URL(string: download) {
                    let alert = UIAlertController(
                        title: "发现新版本 \(version)",
                        message: "当前 \(appVersion)，更新后可继续使用原账号。",
                        preferredStyle: .alert
                    )
                    alert.addAction(UIAlertAction(title: "下载更新", style: .default) { _ in UIApplication.shared.open(url) })
                    alert.addAction(UIAlertAction(title: "稍后", style: .cancel))
                    self.present(alert, animated: true)
                } else if manual {
                    let message = error == nil ? "当前已是最新版本。" : "暂时无法连接更新服务，离线任务不受影响。"
                    let alert = UIAlertController(title: error == nil ? "无需更新" : "更新检查失败", message: message, preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "好", style: .default))
                    self.present(alert, animated: true)
                }
            }
        }.resume()
    }

    private var pilotName: String {
        UserDefaults.standard.string(forKey: "spacefight.displayName") ?? "Player"
    }

    private var amber: UIColor {
        UIColor(red: 0.94, green: 0.64, blue: 0.29, alpha: 1)
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
