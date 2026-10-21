// Decode message text out of chat.db's `attributedBody` BLOB column.
//
// Background: newer macOS versions write `text` as NULL and store the
// message body inside `attributedBody` — a binary blob that's an
// NSKeyedArchiver-encoded NSAttributedString (legacy typedstream format).
//
// photon/imessage-kit uses the @parseaple/typedstream JS package because
// JavaScript can't talk to Foundation. In Swift we ARE Foundation, so we
// can ask NSKeyedUnarchiver directly. The string falls out for free.

import Foundation

enum AttributedBodyDecoder {
    /// Decode the plain string from an attributedBody blob, or nil if it
    /// can't be decoded (corrupt blob, unexpected format, etc.).
    static func decodeText(_ data: Data?) -> String? {
        guard let data, !data.isEmpty else { return nil }

        // Modern path: NSKeyedUnarchiver with secure coding. Apple's
        // archive contains an NSAttributedString graph; we want its
        // backing string.
        do {
            let unarchiver = try NSKeyedUnarchiver(forReadingFrom: data)
            unarchiver.requiresSecureCoding = false
            defer { unarchiver.finishDecoding() }
            if let str = unarchiver.decodeObject(of: NSAttributedString.self, forKey: NSKeyedArchiveRootObjectKey) {
                return str.string
            }
        } catch {
            // Fall through to legacy typedstream scan.
        }

        // Legacy path: pre-NSKeyedArchiver `typedstream`. We can't parse
        // it without a typedstream library, but we can scrape the first
        // printable run of bytes after the well-known "NSString" marker.
        // This is a best-effort fallback for very old messages.
        return scrapeLegacyTypedStream(data)
    }

    private static func scrapeLegacyTypedStream(_ data: Data) -> String? {
        guard let needle = "NSString".data(using: .utf8) else { return nil }
        guard let range = data.range(of: needle) else { return nil }
        // After the NSString marker, Apple writes a length byte then text.
        // We skip ahead a small window and grab printable ASCII/UTF-8 runs.
        let start = range.upperBound
        let scan = data[start..<min(start + 8192, data.endIndex)]
        // Find the longest UTF-8 run that's printable.
        var bestStart = scan.startIndex
        var bestLen = 0
        var runStart = scan.startIndex
        var runLen = 0
        for i in scan.indices {
            let b = scan[i]
            // Printable ASCII or common UTF-8 continuation bytes.
            if (b >= 0x20 && b < 0x7F) || b >= 0x80 {
                if runLen == 0 { runStart = i }
                runLen += 1
            } else {
                if runLen > bestLen {
                    bestLen = runLen
                    bestStart = runStart
                }
                runLen = 0
            }
        }
        if runLen > bestLen {
            bestLen = runLen
            bestStart = runStart
        }
        guard bestLen > 2 else { return nil }
        let slice = scan[bestStart..<bestStart + bestLen]
        return String(data: slice, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
