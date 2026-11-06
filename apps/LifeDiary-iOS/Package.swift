// swift-tools-version:5.8
import PackageDescription
import Foundation

let coreSources = [
    "Models/AppTab.swift",
    "Models/DiaryDraft.swift",
    "Models/DiaryEntry.swift",
    "Models/HealthRecord.swift",
    "Models/ConnectionModels.swift",
    "Models/CommunityDraft.swift",
    "Models/SyncState.swift",
    "Models/OnlineModels.swift",
    "Models/LedgerEntry.swift",
    "Stores/LifeRepository.swift",
    "Stores/CommunityPublisher.swift",
    "Stores/HealthSettingsStore.swift",
    "Services/LifeAPIClient.swift",
    "Services/LifeOnlineClient.swift",
    "Services/MinorPromptCoordinator.swift",
    "Services/PassportSession.swift",
    "Services/SecureTokenStore.swift",
    "Services/AuthTokenStore.swift"
]

let buildApp = ProcessInfo.processInfo.environment["LIFEDIARY_BUILD_APP"] == "1"
let appProducts: [Product] = buildApp ? [.executable(name: "LifeDiary", targets: ["LifeDiary"])] : []
let appTargets: [Target] = buildApp ? [
    .executableTarget(
        name: "LifeDiary",
        dependencies: ["LifeDiaryCore"],
        path: "Sources/LifeDiary",
        exclude: coreSources,
        sources: [
            "App",
            "DesignSystem",
            "Services/UpdateService.swift",
            "Views"
        ],
        resources: [
            .process("Resources/Assets.xcassets")
        ]
    )
] : []
let testTargets: [Target] = buildApp ? [] : [
    .testTarget(
        name: "LifeDiaryTests",
        dependencies: ["LifeDiaryCore"]
    )
]

let package = Package(
    name: "LifeDiary",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "LifeDiaryCore", targets: ["LifeDiaryCore"])] + appProducts,
    targets: [
        .target(
            name: "LifeDiaryCore",
            path: "Sources/LifeDiary",
            exclude: ["App", "DesignSystem", "Views", "Resources", "Services/UpdateService.swift"],
            sources: coreSources
        )
    ] + appTargets + testTargets
)
