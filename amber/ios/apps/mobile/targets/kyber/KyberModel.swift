import Combine
import Foundation
import SwiftUI

// EVERYTHING KYBER KNOWS, AND EVERY ACTION IT CAN TAKE.
//
// Four tabs over one Amber account:
//   Ask     the app's chat (people, places, the web, notes, drafts), plus Remind
//   People  favorites and circles, share a card, intro two people, follow up
//   Plans   today and tomorrow, and the free time between them as a sentence
//   Split   a bill, to the cent, with no network at all
//
// The keyboard cannot read the conversation it sits in. It can read what the
// user has typed into the message field, and it can insert text. So the field
// is both an input (Ask about my draft) and the output (Insert).

enum KyberTab: String, CaseIterable, Identifiable {
    case ask = "Ask", people = "People", plans = "Plans", split = "Split"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .ask: return "sparkle"
        case .people: return "person.2.fill"
        case .plans: return "calendar"
        case .split: return "dollarsign.circle.fill"
        }
    }
}

struct KPerson: Identifiable, Equatable {
    let id: String
    let name: String
    let title: String?
    let company: String?

    var about: String? {
        switch (title?.nilIfBlank, company?.nilIfBlank) {
        case let (t?, c?): return "\(t) at \(c)"
        case let (t?, nil): return t
        case let (nil, c?): return c
        default: return nil
        }
    }

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
    }

    /// A stable warm hue per person, so a face is findable by colour.
    var hue: Double {
        let sum = id.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        return 0.02 + Double(sum % 9) * 0.012
    }

    static func from(_ raw: Any) -> KPerson? {
        guard let d = raw as? [String: Any] else { return nil }
        let id = (d["contactId"] ?? d["id"]).map { "\($0)" } ?? ""
        let name = (d["name"] as? String)?.nilIfBlank ?? (d["displayName"] as? String)?.nilIfBlank
        guard !id.isEmpty, id != "<null>", let name else { return nil }
        return KPerson(id: id, name: name, title: d["title"] as? String, company: d["company"] as? String)
    }
}

struct KCircle: Identifiable, Equatable {
    let id: String
    let name: String
}

struct KPlace: Identifiable, Equatable {
    var id: String { name + (address ?? "") }
    let name: String
    let detail: String?
    let address: String?
    let url: String?
}

struct KSource: Identifiable, Equatable {
    var id: String { url }
    let title: String
    let url: String
}

struct KChip: Identifiable, Equatable {
    let id = UUID()
    let label: String
    let prompt: String
}

struct KAgendaItem: Identifiable, Equatable {
    let id: String
    let title: String
    let start: Date
    let end: Date?
    let isReminder: Bool
}


enum KyberGate: Equatable {
    case ok
    case needsFullAccess
    case signedOut
}

@MainActor
final class KyberModel: ObservableObject {
    // Wiring to the host, set by KeyboardViewController.
    var insert: (String) -> Void = { _ in }
    var readDraft: () -> String = { "" }
    var nextKeyboard: () -> Void = {}
    var haptic: () -> Void = {}

    @Published var tab: KyberTab = .ask
    @Published var gate: KyberGate = .ok
    @Published var needsGlobe = true
    @Published var dark = false

    // Ask
    @Published var query = ""
    @Published var draftPreview = ""
    @Published var answering = false
    @Published var answer = ""
    @Published var stage: String?
    @Published var people: [KPerson] = []
    @Published var places: [KPlace] = []
    @Published var sources: [KSource] = []
    @Published var chips: [KChip] = []
    @Published var clarify: (question: String, candidates: [KPerson], pendingId: String?)?
    @Published var saved: [KSaved] = []
    @Published var error: String?
    @Published var showingResult = false
    private var conversationId: String?
    private var lastQuestion = ""
    private var askTask: Task<Void, Never>?
    /// Bumped by every new question. A stream only writes state while its
    /// generation is current, so a cancelled answer can't clear the spinner or
    /// raise an error over the answer that replaced it.
    private var generation = 0

    // People
    @Published var favorites: [KPerson] = []
    @Published var circles: [KCircle] = []
    @Published var circleFilter: String?
    @Published var selected: KPerson?
    @Published var introFrom: KPerson?
    @Published var peopleLoading = false
    @Published var myLink: String?
    @Published var toast: String?
    private var memberships: [Membership] = []
    private var circleMembers: [String: [KPerson]] = [:]

    // Plans
    @Published var agendaToday: [KAgendaItem] = []
    @Published var agendaTomorrow: [KAgendaItem] = []
    @Published var freeToday: [FreeWindow] = []
    @Published var freeTomorrow: [FreeWindow] = []
    @Published var plansLoading = false
    private var plansLoadedAt: Date?

    // Split
    @Published var splitAmount = ""
    @Published var splitPeople = 2
    @Published var splitTip = 0
    @Published var splitWhat = ""

    private let api = KyberAPI.shared

    // MARK: Lifecycle

    func appeared(fullAccess: Bool) {
        Task { await api.setFullAccess(fullAccess) }
        if !fullAccess { gate = .needsFullAccess }
        else if KyberKeychain.get(KyberKeychain.sessionKey) == nil { gate = .signedOut }
        else { gate = .ok }
        refreshDraft()
        if gate == .ok {
            Task { await loadPeople() }
            Task { await loadPlans() }
        }
    }

    func refreshDraft() {
        draftPreview = readDraft().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func select(_ t: KyberTab) {
        haptic()
        tab = t
        if t == .plans { Task { await loadPlans() } }
    }

    private func handle(_ e: Error) {
        switch e as? KyberSessionError {
        case .noFullAccess: gate = .needsFullAccess
        case .signedOut: gate = .signedOut
        case .http: error = "Amber is having a moment. Try again shortly."
        default: error = "Could not reach Amber. Check your connection."
        }
    }

    func flash(_ text: String) {
        toast = text
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            if toast == text { toast = nil }
        }
    }

    func put(_ text: String, toastText: String = "Inserted") {
        guard !text.isEmpty else { return }
        haptic()
        insert(text)
        refreshDraft()
        flash(toastText)
    }

    // MARK: Ask

    func ask(_ text: String? = nil, followUp: Bool = false, clarifyContactId: String? = nil, pendingId: String? = nil) {
        let message = (text ?? query).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        guard gate == .ok else { return }
        haptic()
        askTask?.cancel()
        if !followUp && clarifyContactId == nil { conversationId = nil }
        lastQuestion = message
        answer = ""; stage = "Thinking"; people = []; places = []; sources = []; chips = []
        clarify = nil; error = nil; saved = []
        answering = true; showingResult = true
        generation += 1
        let mine = generation
        askTask = Task {
            do {
                try await api.chat(message, conversationId: conversationId, clarifyContactId: clarifyContactId, pendingId: pendingId) { [weak self] f in
                    guard let self, self.generation == mine else { return }
                    self.apply(f)
                }
            } catch is CancellationError {
            } catch {
                if generation == mine { handle(error) }
            }
            if generation == mine {
                answering = false
                stage = nil
            }
        }
    }

    func askAboutDraft() {
        refreshDraft()
        guard !draftPreview.isEmpty else { return }
        query = draftPreview
        ask()
    }

    private func apply(_ f: SSEFrame) {
        let d = f.data
        switch f.event {
        case "meta", "complete":
            if let id = d["conversationId"] as? String, !id.isEmpty { conversationId = id }
        case "token":
            answer += (d["text"] as? String) ?? (d["delta"] as? String) ?? ""
            stage = nil
        case "stage":
            if (d["state"] as? String) != "done", let label = d["label"] as? String { stage = label }
        case "people":
            let incoming = ((d["people"] as? [Any]) ?? []).compactMap(KPerson.from)
            // The second `people` event can be a different set; a person the
            // sentence named keeps their chip (same rule as ChatContext).
            let kept = people.filter { p in !incoming.contains { $0.id == p.id } }
            people = incoming + kept
        case "places":
            places = ((d["places"] as? [[String: Any]]) ?? []).compactMap { p in
                guard let name = (p["name"] as? String)?.nilIfBlank else { return nil }
                let detail = [p["cuisine"] as? String, p["category"] as? String, p["neighborhood"] as? String]
                    .compactMap { $0?.nilIfBlank }.first
                return KPlace(name: name, detail: detail, address: (p["address"] as? String)?.nilIfBlank, url: (p["url"] as? String)?.nilIfBlank)
            }
        case "sources":
            sources = ((d["sources"] as? [[String: Any]]) ?? []).compactMap { s in
                guard let url = (s["url"] as? String)?.nilIfBlank else { return nil }
                return KSource(title: (s["title"] as? String)?.nilIfBlank ?? url, url: url)
            }
        case "suggestions":
            chips = ((d["suggestions"] as? [[String: Any]]) ?? []).compactMap { s in
                guard let label = (s["label"] as? String)?.nilIfBlank else { return nil }
                // Only the suggestions that are another question make sense in
                // a keyboard; sheets and drafts belong to the app.
                let prompt = (s["prompt"] as? String) ?? (s["query"] as? String)
                guard let prompt = prompt?.nilIfBlank else { return nil }
                return KChip(label: label, prompt: prompt)
            }
        case "clarify":
            let cands = ((d["candidates"] as? [Any]) ?? []).compactMap(KPerson.from)
            clarify = ((d["question"] as? String) ?? "Which one?", cands, (d["pendingId"]).map { "\($0)" })
        case "error":
            error = (d["message"] as? String)?.nilIfBlank ?? "Amber could not answer that one."
        default:
            break
        }
    }

    /// The answer as text a person would send: markers become names, markdown
    /// becomes plain.
    var insertableAnswer: String {
        var names: [String: String] = [:]
        for p in people { names[p.id] = p.name }
        return KyberText.resolveMarkers(KyberText.plain(answer), names: names)
    }

    func pick(_ candidate: KPerson) {
        guard let c = clarify else { return }
        ask(lastQuestion, followUp: true, clarifyContactId: candidate.id, pendingId: c.pendingId)
    }

    func backToInput() {
        askTask?.cancel()
        generation += 1
        showingResult = false
        answering = false
        query = ""
    }

    /// "Remind me to call mom at 6" -> saved on the Amber account by the same
    /// parser the voice notes use. /v1/reminders/parse SAVES what it finds: a
    /// timed item becomes a calendar event (under `events`), an untimed one a
    /// reminder row (under `reminders`). Posting them again made duplicates and
    /// double notifications, and reading only `reminders` reported "nothing
    /// saved" for every timed one.
    func remind(_ text: String? = nil) {
        let message = (text ?? query).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, gate == .ok else { return }
        haptic()
        askTask?.cancel()
        generation += 1
        let mine = generation
        answer = ""; people = []; places = []; sources = []; chips = []; clarify = nil; error = nil; saved = []
        stage = "Saving"
        answering = true; showingResult = true
        Task {
            do {
                let now = Date()
                let parsed = try await api.json("/v1/reminders/parse", method: "POST", body: [
                    "text": message,
                    "nowISO": ISO8601DateFormatter().string(from: now),
                    "tzOffsetMinutes": TimeZone.current.secondsFromGMT(for: now) / 60,
                ])
                guard generation == mine else { return }
                saved = KyberParse.savedItems(parsed)
                if saved.isEmpty { error = "Couldn't find anything to save. Try \"remind me to call mom at 6\"." }
            } catch {
                if generation == mine { handle(error) }
            }
            if generation == mine {
                answering = false
                stage = nil
            }
        }
    }


    // MARK: People

    func loadPeople() async {
        guard gate == .ok, !peopleLoading else { return }
        peopleLoading = true
        defer { peopleLoading = false }
        async let favs = try? api.json("/v1/me/favorites")
        async let circ = try? api.json("/v1/me/circles")
        async let mems = try? api.json("/v1/me/circles/members")
        async let me = try? api.json("/v1/me")
        let (f, c, m, profile) = await (favs, circ, mems, me)
        favorites = ((f?["favorites"] as? [Any]) ?? []).compactMap(KPerson.from)
        circles = ((c?["circles"] as? [[String: Any]]) ?? []).compactMap { d in
            guard let id = d["id"].map({ "\($0)" }), let name = (d["name"] as? String)?.nilIfBlank else { return nil }
            return KCircle(id: id, name: name)
        }
        var edges: [Membership] = []
        var byCircle: [String: [KPerson]] = [:]
        for raw in (m?["members"] as? [[String: Any]]) ?? [] {
            guard let circleId = raw["circleId"].map({ "\($0)" }), let p = KPerson.from(raw) else { continue }
            edges.append(Membership(circleId: circleId, contactId: p.id))
            byCircle[circleId, default: []].append(p)
        }
        memberships = edges
        circleMembers = byCircle
        // /v1/me answers either the profile or { data: profile }; lib/api.ts reads both.
        let meBody = (profile?["data"] as? [String: Any]) ?? profile
        if let username = (meBody?["username"] as? String)?.nilIfBlank {
            myLink = "\(api.base.absoluteString)/u/@\(username)"
        }
        if f == nil && c == nil { error = "Could not load your people." }
    }

    var visiblePeople: [KPerson] {
        guard let circleFilter else { return favorites }
        return circleMembers[circleFilter] ?? []
    }

    /// Everyone Kyber can see, de-duplicated, favorites first.
    private var pool: [KPerson] {
        var seen = Set<String>()
        return (favorites + circleMembers.values.flatMap { $0 }).filter { seen.insert($0.id).inserted }
    }

    /// While picking the second half of an intro, the grid is reordered by the
    /// circle graph: people who share no circle with the first person lead.
    var introOrder: [(person: KPerson, bridge: Bool)] {
        guard let a = introFrom else { return [] }
        let everyone = pool
        let byId = Dictionary(everyone.map { ($0.id, $0) }, uniquingKeysWith: { x, _ in x })
        return KyberGraph.bridges(for: a.id, pool: everyone.map(\.id), memberships: memberships)
            .compactMap { c in byId[c.contactId].map { ($0, c.sharedCircles == 0) } }
    }

    func tap(_ p: KPerson) {
        haptic()
        if let a = introFrom {
            put(KyberGraph.introSentence((a.name, a.about), (p.name, p.about)), toastText: "Intro inserted")
            introFrom = nil
            return
        }
        selected = selected == p ? nil : p
    }

    func shareCard(_ p: KPerson) {
        var line = p.name
        if let about = p.about { line += ", \(about)" }
        put(line)
        selected = nil
    }

    func startIntro(_ p: KPerson) {
        haptic()
        introFrom = p
        selected = nil
        circleFilter = nil
    }

    func askAbout(_ p: KPerson) {
        selected = nil
        tab = .ask
        query = "What should I know about \(p.name) before I text them?"
        ask()
    }

    func followUp(_ p: KPerson) {
        selected = nil
        guard let due = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date().addingTimeInterval(86_400)) else { return }
        haptic()
        Task {
            do {
                _ = try await api.json("/v1/me/reminders/self", method: "POST", body: [
                    "title": "Follow up with \(p.name)",
                    "dueAt": ISO8601DateFormatter().string(from: due),
                    "contactId": p.id,
                    "contactName": p.name,
                ])
                flash("Reminder set for tomorrow 9am")
            } catch {
                handle(error)
            }
        }
    }

    func shareMyLink() {
        guard let myLink else { flash("Set a username in Amber first"); return }
        put("Connect with me on Amber: \(myLink)")
    }

    // MARK: Plans

    func loadPlans(force: Bool = false) async {
        guard gate == .ok, !plansLoading else { return }
        if !force, let at = plansLoadedAt, Date().timeIntervalSince(at) < 120 { return }
        plansLoading = true
        defer { plansLoading = false }
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        guard let end = cal.date(byAdding: .day, value: 2, to: start) else { return }
        let iso = ISO8601DateFormatter()
        let path = "/v1/me/agenda?from=\(iso.string(from: start).urlQuery)&to=\(iso.string(from: end).urlQuery)"
        do {
            let d = try await api.json(path)
            var items: [KAgendaItem] = []
            for e in (d["events"] as? [[String: Any]]) ?? [] {
                if (e["allDay"] as? Bool) == true { continue }
                guard let s = (e["startsAt"] as? String).flatMap(KyberParse.iso) else { continue }
                let endAt = (e["endsAt"] as? String).flatMap(KyberParse.iso)
                items.append(KAgendaItem(id: "\(e["id"] ?? UUID().uuidString)", title: (e["title"] as? String)?.nilIfBlank ?? "Busy", start: s, end: endAt, isReminder: false))
            }
            for r in (d["reminders"] as? [[String: Any]]) ?? [] {
                if (r["done"] as? Bool) == true { continue }
                guard let s = (r["startsAt"] as? String).flatMap(KyberParse.iso) else { continue }
                items.append(KAgendaItem(id: "\(r["id"] ?? UUID().uuidString)", title: (r["title"] as? String)?.nilIfBlank ?? "Reminder", start: s, end: nil, isReminder: true))
            }
            items.sort { $0.start < $1.start }
            let tomorrow = cal.date(byAdding: .day, value: 1, to: start) ?? start
            agendaToday = items.filter { cal.isDate($0.start, inSameDayAs: start) }
            agendaTomorrow = items.filter { cal.isDate($0.start, inSameDayAs: tomorrow) }
            // Reminders are not busy time: only events block a free window. An
            // event with no end is counted as an hour, guessed, never measured.
            let busy = items.filter { !$0.isReminder }.map { Busy(start: $0.start, end: $0.end ?? $0.start.addingTimeInterval(3600)) }
            freeToday = KyberFree.windows(on: start, busy: busy, now: Date())
            freeTomorrow = KyberFree.windows(on: tomorrow, busy: busy, now: Date())
            plansLoadedAt = Date()
        } catch {
            handle(error)
        }
    }

    var freeSentence: String { KyberFree.sentence(today: freeToday, tomorrow: freeTomorrow) }

    func insertEvent(_ item: KAgendaItem, today: Bool) {
        let day = today ? "today" : "tomorrow"
        put(item.isReminder ? "I need to \(item.title.lowercasedFirst) \(day) at \(KyberFree.clock(item.start))"
                            : "I've got \(item.title) \(day) at \(KyberFree.clock(item.start))")
    }

    // MARK: Split

    var splitResult: SplitResult? {
        guard let amount = Decimal(string: splitAmount) else { return nil }
        return KyberSplit.split(amount: amount, people: splitPeople, tipPercent: splitTip)
    }

    func splitKey(_ k: String) {
        haptic()
        switch k {
        case "⌫": if !splitAmount.isEmpty { splitAmount.removeLast() }
        case ".": if !splitAmount.contains(".") { splitAmount += splitAmount.isEmpty ? "0." : "." }
        default:
            if let dot = splitAmount.firstIndex(of: "."), splitAmount[dot...].count > 2 { return }
            if splitAmount.count >= 8 { return }
            splitAmount = splitAmount == "0" ? k : splitAmount + k
        }
    }

    func insertSplit() {
        guard let r = splitResult else { return }
        put(KyberSplit.sentence(r, people: splitPeople, tipPercent: splitTip, what: splitWhat))
    }
}

extension String {
    var nilIfBlank: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
    var urlQuery: String { addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? self }
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
}
