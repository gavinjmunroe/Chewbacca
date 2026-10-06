// swift-tools-version:5.9
// permission-guide: the card that floats over System Settings and walks a
// person through one Privacy grant. A port of Anarlog's permission assistant
// (fastrepl/anarlog, plugins/permissions, MIT) from Rust and objc2 to Swift.
import PackageDescription

let package = Package(
    name: "permission-guide",
    // Anarlog's assistant targets the System Settings that shipped with
    // Ventura (13): before it the pane was System Preferences and the deep
    // links, the window shape and the sidebar width it anchors to all differ.
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "permission-guide",
            path: "Sources/PermissionGuide",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
    ]
)
