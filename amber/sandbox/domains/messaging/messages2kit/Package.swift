// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Messages2Kit",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .library(
            name: "Messages2Kit",
            targets: ["Messages2Kit"]
        ),
        .executable(
            name: "messages2",
            targets: ["Messages2CLI"]
        ),
    ],
    dependencies: [
        // GRDB: idiomatic SQLite wrapper. We pin the major to avoid
        // surprise API churn during ClearOut integration.
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.29.0"),
        // Apple's official arg parser for the CLI executable.
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.5.0"),
    ],
    targets: [
        .target(
            name: "Messages2Kit",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .executableTarget(
            name: "Messages2CLI",
            dependencies: [
                "Messages2Kit",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ]
        ),
        .testTarget(
            name: "Messages2KitTests",
            dependencies: ["Messages2Kit"]
        ),
    ]
)
