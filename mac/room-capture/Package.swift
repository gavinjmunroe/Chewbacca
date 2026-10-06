// swift-tools-version:5.9
// 5.9, not 6: a Swift 6 language mode turns ScreenCaptureKit's non-Sendable
// callbacks into hard errors, and this machine runs 6.2 while a collaborator's
// runs 6.1.2 (memory, feedback_builds_on_mine_is_not_builds). Language mode 5
// builds on both.
import PackageDescription

let package = Package(
    name: "RoomCapture",
    // macOS 13: the first release where SCStreamConfiguration.capturesAudio
    // and excludesCurrentProcessAudio exist.
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "room-capture",
            path: "Sources/RoomCapture",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreMedia"),
                // The usage string macOS shows when the mic is first asked
                // for. A bare command-line binary has no Info.plist, and a
                // process that touches the mic without one can be killed by
                // TCC instead of being prompted.
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
                              "-Xlinker", "Info.plist"]),
            ]
        ),
    ]
)
