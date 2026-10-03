import Foundation

/// Held before AppKit or any hotkeys start, independently of the socket path.
/// A second copy must not create another overlay even when its socket differs.
public final class HUDInstanceLock {
    private let descriptor: Int32

    public static var defaultPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".bob/hud.instance.lock").path
    }

    /// Nil means another instance owns the display. Other failures are errors.
    public init?(path: String = HUDInstanceLock.defaultPath) throws {
        let directory = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(
            atPath: directory, withIntermediateDirectories: true)
        let fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let error = errno
            close(fd)
            if error == EWOULDBLOCK { return nil }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(error))
        }
        descriptor = fd
    }

    deinit {
        // Never unlink: a waiting launch must lock this same inode. Closing
        // releases ownership, including after a crash; children cannot inherit
        // it across exec and keep the HUD locked after the app exits.
        close(descriptor)
    }
}
