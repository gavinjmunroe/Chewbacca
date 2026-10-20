// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NewLoom",
    platforms: [
        .macOS(.v13),
    ],
    targets: [
        .executableTarget(
            name: "NewLoom",
            path: "NewLoom"
        ),
    ]
)
