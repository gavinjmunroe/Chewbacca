import Foundation

/// Who may draw on which surfaces (bd_2026-Code-9rl).
///
/// Surface names were global and unowned: any process running as the user
/// could open the socket, send `@ amber.inbox` and overwrite a panel another
/// tool drew, clear the whole glass with `-`, or point the conversation input
/// at someone else's card with `to`. Nothing on the glass said where a panel
/// came from, so a forged one read exactly like the real thing.
///
/// A connection that showed the token can now claim a namespace:
///
///     claim amber token=<hex>          ->  e claimed amber
///
/// and from then until it hangs up, the surfaces `amber` and `amber.<anything>`
/// are its alone. Another connection that addresses one gets a `!` line saying
/// whose it is, and its drawing lines are dropped until it names a surface it
/// may draw on. A claimed surface carries its namespace on the card, so the
/// person can see who drew it.
///
/// Claiming is opt-in. A glass where nobody claimed anything behaves exactly
/// as it did before, which is why this could land without touching a sender.
///
/// It is not a security boundary against code running as the same user: that
/// code can read the token too. What it does stop is the silent part, a panel
/// replaced without its owner or the person being told, and it keeps a
/// sandboxed app (which cannot read `~/.bob`) out entirely.
///
/// Pure, so the rules are tested without a socket; `SocketServer` holds one
/// under its lock.
struct SurfaceClaims {
    /// What to do with one line from one connection.
    struct Routed: Equatable {
        /// The lines to hand on, each with the namespace that vouches for
        /// it, or nil when nobody does.
        var lines: [(line: String, owner: String?)] = []
        /// Said back to the sender only, as a `!` line.
        var problem: String?

        static func == (a: Routed, b: Routed) -> Bool {
            a.problem == b.problem && a.lines.map(\.line) == b.lines.map(\.line)
                && a.lines.map(\.owner) == b.lines.map(\.owner)
        }
    }

    /// Namespace to the connection holding it.
    private(set) var namespaces: [String: Int32] = [:]
    /// The surface each connection last named with an accepted `@`.
    private var drawing: [Int32: String] = [:]
    /// Connections whose last `@` was refused: their component lines are
    /// dropped until they name a surface they may draw on.
    private var refused: Set<Int32> = []
    /// The connection whose `@` the overlay acted on last. The overlay keeps
    /// one "current surface" for the whole glass, so a second connection's
    /// `@` between someone's `@` and their `c` used to land that `c` on the
    /// wrong panel. When the connection changes, its `@` is sent again first.
    private var lastSwitch: Int32?

    /// Longest namespace accepted. Surface names cap at 64 characters
    /// (`SurfaceStore.isValidID`), and a namespace has to leave room for the
    /// `.name` after it. Guessed, never measured.
    static let maxNamespace = 32

    /// The verbs that write into whichever surface is current.
    static let drawingVerbs: Set<String> = ["c", ">", "d", "r"]

    /// Whether `namespace` covers `surface`: the namespace itself, or a name
    /// under it after a dot.
    static func covers(_ namespace: String, _ surface: String) -> Bool {
        surface == namespace || surface.hasPrefix(namespace + ".")
    }

    /// The claimed namespace covering `surface`, if any.
    func namespace(of surface: String) -> String? {
        namespaces.keys.filter { Self.covers($0, surface) }.max { $0.count < $1.count }
    }

    /// Whether `fd` may address `surface`: it is unclaimed, or `fd` claimed it.
    func mayAddress(_ surface: String, from fd: Int32) -> Bool {
        guard let namespace = namespace(of: surface) else { return true }
        return namespaces[namespace] == fd
    }

    /// Whether anyone other than `fd` holds a claim.
    private func othersClaim(besides fd: Int32) -> Bool {
        namespaces.values.contains { $0 != fd }
    }

    /// Claim `namespace` for `fd`. Returns the problem, or nil when it took.
    /// The caller has already checked the token.
    mutating func claim(_ namespace: String, by fd: Int32) -> String? {
        guard !namespace.isEmpty, namespace.count <= Self.maxNamespace,
              namespace.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        else {
            return "a namespace is 1 to \(Self.maxNamespace) letters, digits, - or _"
        }
        if let holder = namespaces[namespace], holder != fd {
            return "\(namespace) is already claimed by another connection"
        }
        // A namespace inside or around someone else's would let the two
        // fight over the same names.
        if let clash = namespaces.first(where: {
            $0.value != fd && (Self.covers($0.key, namespace) || Self.covers(namespace, $0.key))
        }) {
            return "\(namespace) overlaps \(clash.key), which another connection holds"
        }
        namespaces[namespace] = fd
        return nil
    }

    /// Forget everything about a connection that hung up. Its claims lapse:
    /// its panels stay on the glass, and anyone may now address them.
    mutating func disconnect(_ fd: Int32) {
        namespaces = namespaces.filter { $0.value != fd }
        drawing[fd] = nil
        refused.remove(fd)
        if lastSwitch == fd { lastSwitch = nil }
    }

    /// Route one trimmed line from `fd`.
    mutating func route(_ line: String, from fd: Int32) -> Routed {
        let tokens = LineParser.tokenize(line)
        guard let verb = tokens.first else { return Routed(lines: [(line, nil)]) }

        switch verb {
        case "@":
            guard tokens.count >= 2 else { return Routed(lines: [(line, nil)]) }
            let surface = tokens[1]
            guard mayAddress(surface, from: fd) else {
                refused.insert(fd)
                drawing[fd] = nil
                return Routed(problem: Self.refusal(surface, namespace(of: surface)))
            }
            refused.remove(fd)
            drawing[fd] = surface
            lastSwitch = fd
            return Routed(lines: [(line, owner(of: surface, for: fd))])

        case _ where Self.drawingVerbs.contains(verb):
            if refused.contains(fd) { return Routed() }
            guard let surface = drawing[fd] else {
                // Never named a surface. Without claims this goes wherever
                // the overlay's current surface is, as it always did; with
                // someone else's claim on the glass that could be theirs.
                if othersClaim(besides: fd) {
                    return Routed(problem: "name a surface with `@ <surface>` first: "
                        + "other connections have claimed surfaces on the glass")
                }
                return Routed(lines: [(line, nil)])
            }
            // Claimed after this connection's `@`? Then it is no longer theirs.
            guard mayAddress(surface, from: fd) else {
                refused.insert(fd)
                drawing[fd] = nil
                return Routed(problem: Self.refusal(surface, namespace(of: surface)))
            }
            var out = Routed()
            if lastSwitch != fd {
                out.lines.append(("@ \(surface)", owner(of: surface, for: fd)))
                lastSwitch = fd
            }
            out.lines.append((line, owner(of: surface, for: fd)))
            return out

        case "-":
            if tokens.count >= 2 {
                guard mayAddress(tokens[1], from: fd) else {
                    return Routed(problem: Self.refusal(tokens[1], namespace(of: tokens[1])))
                }
                return Routed(lines: [(line, nil)])
            }
            // Clearing the glass would take other connections' panels with
            // it. The person can still clear everything with Escape.
            if othersClaim(besides: fd) {
                return Routed(problem: "`-` would clear surfaces other connections claimed; "
                    + "close yours by name with `- <surface>`")
            }
            return Routed(lines: [(line, nil)])

        case "glance", "to":
            // `to <surface>` points the person's typing at that surface's
            // drawer, so it is the one verb where a forged name reads what
            // they type, not only what they see.
            if tokens.count >= 2, tokens[1] != "off", !mayAddress(tokens[1], from: fd) {
                return Routed(problem: Self.refusal(tokens[1], namespace(of: tokens[1])))
            }
            return Routed(lines: [(line, nil)])

        default:
            return Routed(lines: [(line, nil)])
        }
    }

    /// The namespace vouching for `surface` when `fd` holds it.
    private func owner(of surface: String, for fd: Int32) -> String? {
        guard let namespace = namespace(of: surface), namespaces[namespace] == fd else { return nil }
        return namespace
    }

    static func refusal(_ surface: String, _ namespace: String?) -> String {
        "surface \(surface) belongs to \(namespace ?? "another connection"), which claimed it; "
            + "nothing was drawn. Pick a name outside that namespace."
    }
}
