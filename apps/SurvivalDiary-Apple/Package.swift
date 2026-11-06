// swift-tools-version: 5.8
import PackageDescription

let package = Package(
    name: "SurvivalDiaryApple",
    defaultLocalization: "zh-Hans",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "SurvivalDiaryCore", targets: ["SurvivalDiaryCore"]),
        .library(name: "SurvivalDiaryGame", targets: ["SurvivalDiaryGame"]),
        .library(name: "SurvivalDiaryUI", targets: ["SurvivalDiaryUI"]),
        .library(name: "SurvivalDiaryOnline", targets: ["SurvivalDiaryOnline"]),
        .executable(name: "SurvivalDiaryIOS", targets: ["SurvivalDiaryIOS"]),
        .executable(name: "SurvivalDiaryMac", targets: ["SurvivalDiaryMac"]),
    ],
    targets: [
        .target(name: "SurvivalDiaryCore"),
        .target(
            name: "SurvivalDiaryGame",
            dependencies: ["SurvivalDiaryCore"],
            resources: [.process("Resources")]
        ),
        .target(
            name: "SurvivalDiaryUI",
            dependencies: ["SurvivalDiaryCore", "SurvivalDiaryGame", "SurvivalDiaryOnline"],
            resources: [.process("Resources")]
        ),
        .target(name: "SurvivalDiaryOnline", dependencies: ["SurvivalDiaryCore"]),
        .executableTarget(
            name: "SurvivalDiaryIOS",
            dependencies: ["SurvivalDiaryCore", "SurvivalDiaryGame", "SurvivalDiaryUI", "SurvivalDiaryOnline"]
        ),
        .executableTarget(
            name: "SurvivalDiaryMac",
            dependencies: ["SurvivalDiaryCore", "SurvivalDiaryGame", "SurvivalDiaryUI", "SurvivalDiaryOnline"]
        ),
        .testTarget(
            name: "SurvivalDiaryCoreTests",
            dependencies: ["SurvivalDiaryCore"]
        ),
        .testTarget(
            name: "SurvivalDiaryGameTests",
            dependencies: ["SurvivalDiaryGame", "SurvivalDiaryCore"]
        ),
        .testTarget(name: "SurvivalDiaryOnlineTests", dependencies: ["SurvivalDiaryOnline", "SurvivalDiaryCore"]),
    ]
)
