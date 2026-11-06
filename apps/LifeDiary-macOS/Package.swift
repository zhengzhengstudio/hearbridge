// swift-tools-version:5.8
import PackageDescription

let package = Package(
    name: "LifeDiary",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "LifeDiary", targets: ["LifeDiary"])],
    targets: [
        .executableTarget(name: "LifeDiary"),
        .testTarget(name: "LifeDiaryTests", dependencies: ["LifeDiary"])
    ]
)
