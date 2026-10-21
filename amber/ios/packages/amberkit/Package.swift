// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AmberKit",
    platforms: [
        .iOS(.v17), .macOS(.v14), .visionOS(.v1)
    ],
    products: [
        .library(name: "AmberKit", targets: ["AmberKit"])
    ],
    targets: [
        .target(name: "AmberKit")
    ]
)

