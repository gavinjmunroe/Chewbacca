import AppKit
import SwiftUI

/// Syntax color for code on the glass: the Diff surface and the File editor.
///
/// A line scanner, not a parser. It finds comments, strings, numbers,
/// keywords, type names and attributes, which is what a glance at a diff
/// needs to tell code from prose and a string from a call. It carries one
/// piece of state between lines, an open block comment, so a `/* ... */`
/// over several lines stays grey. Anything it does not know is plain.
///
/// Written here rather than borrowed: CodeEdit's highlighter (MIT, cleared in
/// docs/plans/NO-APPS.md) sits on tree-sitter grammars, a dependency the HUD
/// package does not carry. tree-sitter is the v2 path for "what touches X";
/// for color, a scanner is enough. The text is untrusted and only drawn.
public enum Syntax {
    public enum Kind: String, Sendable {
        case plain, keyword, string, comment, number, type, attribute
    }

    public struct Token: Equatable, Sendable {
        public let text: String
        public let kind: Kind
    }

    public struct Language: Equatable, Sendable {
        public let name: String
        let keywords: Set<String>
        let lineComment: [String]
        let blockComment: (open: String, close: String)?
        let quotes: Set<Character>
        /// Capitalized identifiers are type names (Swift, TS, Python classes).
        let capsAreTypes: Bool

        public static func == (a: Language, b: Language) -> Bool { a.name == b.name }
    }

    /// Carried from one line to the next.
    public struct State: Equatable, Sendable {
        public var inBlockComment = false
        public init() {}
    }

    // MARK: Languages

    private static let cFamily = ["//"]
    private static let block = (open: "/*", close: "*/")

    static let swift = Language(
        name: "swift",
        keywords: ["actor", "any", "as", "associatedtype", "async", "await", "break", "case", "catch", "class",
                   "continue", "default", "defer", "deinit", "do", "else", "enum", "extension", "fallthrough",
                   "false", "fileprivate", "final", "for", "func", "guard", "if", "import", "in", "init", "inout",
                   "internal", "is", "let", "lazy", "mutating", "nil", "nonisolated", "open", "operator",
                   "override", "private", "protocol", "public", "repeat", "rethrows", "return", "self", "Self",
                   "some", "static", "struct", "subscript", "super", "switch", "throw", "throws", "true", "try",
                   "typealias", "var", "weak", "where", "while"],
        lineComment: cFamily, blockComment: block, quotes: ["\""], capsAreTypes: true)

    static let python = Language(
        name: "python",
        keywords: ["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
                   "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
                   "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "self", "try",
                   "while", "with", "yield"],
        lineComment: ["#"], blockComment: nil, quotes: ["\"", "'"], capsAreTypes: true)

    static let javascript = Language(
        name: "javascript",
        keywords: ["abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
                   "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false",
                   "finally", "for", "from", "function", "if", "implements", "import", "in", "instanceof",
                   "interface", "let", "new", "null", "of", "private", "protected", "public", "readonly",
                   "return", "static", "super", "switch", "this", "throw", "true", "try", "type", "typeof",
                   "undefined", "var", "void", "while", "yield"],
        lineComment: cFamily, blockComment: block, quotes: ["\"", "'", "`"], capsAreTypes: true)

    static let shell = Language(
        name: "shell",
        keywords: ["case", "do", "done", "elif", "else", "esac", "export", "fi", "for", "function", "if", "in",
                   "local", "readonly", "return", "set", "then", "until", "while"],
        lineComment: ["#"], blockComment: nil, quotes: ["\"", "'"], capsAreTypes: false)

    static let go = Language(
        name: "go",
        keywords: ["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough",
                   "false", "for", "func", "go", "goto", "if", "import", "interface", "map", "nil", "package",
                   "range", "return", "select", "struct", "switch", "true", "type", "var"],
        lineComment: cFamily, blockComment: block, quotes: ["\"", "`"], capsAreTypes: false)

    static let rust = Language(
        name: "rust",
        keywords: ["as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
                   "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
                   "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
                   "unsafe", "use", "where", "while"],
        lineComment: cFamily, blockComment: block, quotes: ["\""], capsAreTypes: true)

    static let cLike = Language(
        name: "c",
        keywords: ["auto", "break", "case", "char", "class", "const", "continue", "default", "do", "double",
                   "else", "enum", "extern", "false", "float", "for", "if", "include", "int", "long", "namespace",
                   "new", "nullptr", "private", "protected", "public", "return", "short", "signed", "sizeof",
                   "static", "struct", "switch", "template", "this", "true", "typedef", "union", "unsigned",
                   "void", "volatile", "while", "import", "interface", "implementation", "end", "property",
                   "fun", "val", "var", "package", "extends", "implements", "final", "abstract", "override"],
        lineComment: cFamily, blockComment: block, quotes: ["\"", "'"], capsAreTypes: true)

    static let ruby = Language(
        name: "ruby",
        keywords: ["begin", "class", "def", "do", "else", "elsif", "end", "ensure", "false", "if", "module",
                   "nil", "require", "rescue", "return", "self", "then", "true", "unless", "until", "when",
                   "while", "yield"],
        lineComment: ["#"], blockComment: nil, quotes: ["\"", "'"], capsAreTypes: true)

    static let data = Language(
        name: "data",
        keywords: ["true", "false", "null", "yes", "no", "on", "off"],
        lineComment: ["#"], blockComment: nil, quotes: ["\"", "'"], capsAreTypes: false)

    static let json = Language(
        name: "json", keywords: ["true", "false", "null"],
        lineComment: [], blockComment: nil, quotes: ["\""], capsAreTypes: false)

    static let css = Language(
        name: "css", keywords: ["important", "media", "import", "supports", "keyframes"],
        lineComment: [], blockComment: block, quotes: ["\"", "'"], capsAreTypes: false)

    static let sql = Language(
        name: "sql",
        keywords: ["select", "from", "where", "and", "or", "not", "insert", "into", "values", "update", "set",
                   "delete", "create", "table", "index", "on", "join", "left", "inner", "group", "by", "order",
                   "limit", "as", "null", "primary", "key", "references", "begin", "commit"],
        lineComment: ["--"], blockComment: block, quotes: ["'", "\""], capsAreTypes: false)

    /// The language a file name names, or nil for one this does not color.
    public static func language(forPath path: String) -> Language? {
        let name = (path as NSString).lastPathComponent.lowercased()
        if ["makefile", "dockerfile", ".zshrc", ".bashrc", ".zprofile"].contains(name) { return shell }
        switch (name as NSString).pathExtension {
        case "swift": return swift
        case "py", "pyi": return python
        case "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts": return javascript
        case "sh", "bash", "zsh", "command": return shell
        case "go": return go
        case "rs": return rust
        case "c", "h", "m", "mm", "cc", "cpp", "hpp", "java", "kt", "kts", "cs", "metal": return cLike
        case "rb": return ruby
        case "yaml", "yml", "toml", "ini", "cfg", "conf", "env": return data
        case "json", "jsonl": return json
        case "css", "scss": return css
        case "sql": return sql
        default: return nil
        }
    }

    /// A file with no extension, such as a script in bin/, says its
    /// language on its first line.
    public static func language(forShebang firstLine: String) -> Language? {
        guard firstLine.hasPrefix("#!") else { return nil }
        if firstLine.contains("python") { return python }
        if firstLine.contains("node") || firstLine.contains("deno") || firstLine.contains("bun") { return javascript }
        if firstLine.contains("sh") { return shell }
        if firstLine.contains("ruby") { return ruby }
        if firstLine.contains("swift") { return swift }
        return nil
    }

    // MARK: Scanning

    /// One line into tokens that, joined, give the line back exactly.
    public static func tokens(_ line: String, _ lang: Language, state: inout State) -> [Token] {
        let chars = Array(line)
        var out: [Token] = []
        var plain = ""
        var i = 0

        func flush() {
            if !plain.isEmpty { out.append(Token(text: plain, kind: .plain)); plain = "" }
        }
        func starts(_ s: String, at index: Int) -> Bool {
            let p = Array(s)
            guard !p.isEmpty, index + p.count <= chars.count else { return false }
            return Array(chars[index..<index + p.count]) == p
        }

        while i < chars.count {
            if state.inBlockComment, let blockComment = lang.blockComment {
                var j = i
                while j < chars.count && !starts(blockComment.close, at: j) { j += 1 }
                let end = min(chars.count, j + (j < chars.count ? blockComment.close.count : 0))
                if j < chars.count { state.inBlockComment = false }
                flush()
                out.append(Token(text: String(chars[i..<end]), kind: .comment))
                i = end
                continue
            }
            let c = chars[i]
            if let blockComment = lang.blockComment, starts(blockComment.open, at: i) {
                flush()
                state.inBlockComment = true
                var j = i + blockComment.open.count
                while j < chars.count && !starts(blockComment.close, at: j) { j += 1 }
                let end = min(chars.count, j + (j < chars.count ? blockComment.close.count : 0))
                if j < chars.count { state.inBlockComment = false }
                out.append(Token(text: String(chars[i..<end]), kind: .comment))
                i = end
                continue
            }
            if lang.lineComment.contains(where: { starts($0, at: i) })
                && (lang.name != "shell" || i == 0 || chars[i - 1] == " " || chars[i - 1] == "\t") {
                flush()
                out.append(Token(text: String(chars[i...]), kind: .comment))
                break
            }
            if lang.quotes.contains(c) {
                flush()
                var j = i + 1
                while j < chars.count {
                    if chars[j] == "\\" { j += 2; continue }
                    if chars[j] == c { j += 1; break }
                    j += 1
                }
                let end = min(j, chars.count)
                out.append(Token(text: String(chars[i..<end]), kind: .string))
                i = end
                continue
            }
            if c == "@" && i + 1 < chars.count && (chars[i + 1].isLetter || chars[i + 1] == "_") {
                flush()
                var j = i + 1
                while j < chars.count && (chars[j].isLetter || chars[j].isNumber || chars[j] == "_") { j += 1 }
                out.append(Token(text: String(chars[i..<j]), kind: .attribute))
                i = j
                continue
            }
            if c.isNumber && (i == 0 || !(chars[i - 1].isLetter || chars[i - 1] == "_")) {
                flush()
                var j = i
                while j < chars.count && (chars[j].isNumber || chars[j].isLetter || chars[j] == "." || chars[j] == "_") {
                    j += 1
                }
                out.append(Token(text: String(chars[i..<j]), kind: .number))
                i = j
                continue
            }
            if c.isLetter || c == "_" {
                var j = i
                while j < chars.count && (chars[j].isLetter || chars[j].isNumber || chars[j] == "_") { j += 1 }
                let word = String(chars[i..<j])
                let kind: Kind
                if lang.keywords.contains(word) || (lang.name == "sql" && lang.keywords.contains(word.lowercased())) {
                    kind = .keyword
                } else if lang.capsAreTypes, let first = word.first, first.isUppercase {
                    kind = .type
                } else {
                    kind = .plain
                }
                if kind == .plain {
                    plain += word
                } else {
                    flush()
                    out.append(Token(text: word, kind: kind))
                }
                i = j
                continue
            }
            plain.append(c)
            i += 1
        }
        flush()
        return out
    }

    // MARK: Color

    /// On dark glass, each one holds 4.5:1 over the panel. Green and red are
    /// left to the diff's own added and removed lines, so a string never
    /// reads as an addition.
    public static func color(_ kind: Kind) -> Color {
        switch kind {
        case .plain: return HUD.ink.opacity(0.9)
        case .keyword: return Color(red: 0.99, green: 0.56, blue: 0.80)
        case .string: return Color(red: 0.99, green: 0.80, blue: 0.50)
        case .comment: return HUD.ink.opacity(0.5)
        case .number: return Color(red: 0.78, green: 0.66, blue: 1.00)
        case .type: return HUD.accent
        case .attribute: return Color(red: 0.99, green: 0.56, blue: 0.80)
        }
    }

    public static func attributed(_ tokens: [Token]) -> AttributedString {
        var out = AttributedString()
        for token in tokens {
            var piece = AttributedString(token.text)
            piece.foregroundColor = color(token.kind)
            out += piece
        }
        return out
    }

    /// Color a whole text into an NSTextStorage in place, for the editor.
    /// Ranges are UTF-16, which is what NSString counts.
    @MainActor
    static func paint(_ storage: NSTextStorage, _ lang: Language?, font: NSFont) {
        let whole = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.setAttributes([.font: font, .foregroundColor: NSColor(color(.plain))], range: whole)
        // A whole-document rescan runs on every keystroke; past this a big
        // file stays plain rather than lagging the caret. Guessed, never measured.
        if let lang, storage.length <= 200_000 {
            var state = State()
            var offset = 0
            let text = storage.string
            for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
                for token in tokens(String(line), lang, state: &state) {
                    let length = token.text.utf16.count
                    if token.kind != .plain {
                        storage.addAttribute(.foregroundColor, value: NSColor(color(token.kind)),
                                             range: NSRange(location: offset, length: length))
                    }
                    offset += length
                }
                offset += 1  // the newline
            }
        }
        storage.endEditing()
    }
}
