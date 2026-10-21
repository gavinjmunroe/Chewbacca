import Foundation

public struct AmberClient {
    public let baseURL: URL
    private let session: URLSession
    private var authToken: String?

    public init(baseURL: URL, session: URLSession = .shared, authToken: String? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
    }
    
    /// Create authenticated request with Bearer token
    private func authenticatedRequest(url: URL, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = body {
            request.httpBody = body
        }
        return request
    }

    public func health() async throws -> Bool {
        let url = baseURL.appendingPathComponent("health")
        let (data, resp) = try await session.data(from: url)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return false }
        return (try? JSONSerialization.jsonObject(with: data)) != nil
    }

    // Persons
    public func listPersons() async throws -> [Person] {
        let url = baseURL.appendingPathComponent("persons")
        let request = authenticatedRequest(url: url)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode([Person].self, from: data)
    }

    public func createPerson(_ person: PersonCreate) async throws -> Person {
        let url = baseURL.appendingPathComponent("persons")
        let body = try JSONEncoder().encode(person)
        let request = authenticatedRequest(url: url, method: "POST", body: body)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(Person.self, from: data)
    }

    public func deletePerson(_ id: Int) async throws {
        let url = baseURL.appendingPathComponent("persons/\(id)")
        let request = authenticatedRequest(url: url, method: "DELETE")
        _ = try await session.data(for: request)
    }

    // Relationships
    public func listRelationships() async throws -> [Relationship] {
        let url = baseURL.appendingPathComponent("relationships")
        let request = authenticatedRequest(url: url)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode([Relationship].self, from: data)
    }

    public func createRelationship(_ rel: RelationshipCreate) async throws -> Relationship {
        let url = baseURL.appendingPathComponent("relationships")
        let body = try JSONEncoder().encode(rel)
        let request = authenticatedRequest(url: url, method: "POST", body: body)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(Relationship.self, from: data)
    }

    public func getPersonRelationships(_ personId: Int) async throws -> [Relationship] {
        let url = baseURL.appendingPathComponent("persons/\(personId)/relationships")
        let request = authenticatedRequest(url: url)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode([Relationship].self, from: data)
    }

    // Insights
    public func listInsights(priority: InsightPriority? = nil, topic: InsightTopic? = nil) async throws -> [InsightCard] {
        var components = URLComponents(url: baseURL.appendingPathComponent("insights"), resolvingAgainstBaseURL: false)!
        var queryItems: [URLQueryItem] = []
        if let p = priority { queryItems.append(URLQueryItem(name: "priority", value: p.rawValue)) }
        if let t = topic { queryItems.append(URLQueryItem(name: "topic", value: t.rawValue)) }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        let request = authenticatedRequest(url: components.url!)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode([InsightCard].self, from: data)
    }

    public func generateInsights() async throws -> InsightCard {
        let url = baseURL.appendingPathComponent("insights/generate")
        let request = authenticatedRequest(url: url, method: "POST")
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(InsightCard.self, from: data)
    }

    // Legacy Contact methods for backward compatibility
    public func listContacts() async throws -> [Contact] {
        try await listPersons()
    }

    public func createContact(_ contact: ContactCreate) async throws -> Contact {
        try await createPerson(contact)
    }

    public func runPipeline(_ def: PipelineDef) async throws -> PipelineRun {
        let url = baseURL.appendingPathComponent("pipelines/run")
        let body = try JSONEncoder().encode(def)
        let request = authenticatedRequest(url: url, method: "POST", body: body)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(PipelineRun.self, from: data)
    }

    public func getRun(_ id: String) async throws -> PipelineRunStatus {
        let url = baseURL.appendingPathComponent("pipelines/run/\(id)")
        let request = authenticatedRequest(url: url)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(PipelineRunStatus.self, from: data)
    }
}

// Person (family member)
public struct Person: Codable, Identifiable {
    public let id: Int
    public let name: String
    public let dob: String?
    public let email: String?
    public let cNFT: String?
    
    // For Identifiable conformance with Int
    public var idValue: String { String(id) }
}

public struct PersonCreate: Codable {
    public let name: String
    public let dob: String?
    public let email: String?
    public init(name: String, dob: String? = nil, email: String? = nil) {
        self.name = name
        self.dob = dob
        self.email = email
    }
}

// Relationship
public struct Relationship: Codable, Identifiable {
    public let id: Int
    public let fromId: Int
    public let toId: Int
    public let type: RelationshipType
    public let strength: Int
    public let createdAt: String
    
    // For Identifiable conformance with Int
    public var idValue: String { String(id) }
}

public enum RelationshipType: String, Codable {
    case parent, sibling, partner, child, other
}

public struct RelationshipCreate: Codable {
    public let fromId: Int
    public let toId: Int
    public let type: RelationshipType
    public let strength: Int?
    public init(fromId: Int, toId: Int, type: RelationshipType, strength: Int? = nil) {
        self.fromId = fromId
        self.toId = toId
        self.type = type
        self.strength = strength
    }
}

// Insight Card
public struct InsightCard: Codable, Identifiable {
    public let id: Int
    public let priority: InsightPriority
    public let topic: InsightTopic
    public let content: String
    public let sources: [String]
    public let createdAt: String
    
    // For Identifiable conformance with Int
    public var idValue: String { String(id) }
}

public enum InsightPriority: String, Codable {
    case high, medium, low
}

public enum InsightTopic: String, Codable {
    case health, connection, memory
}

// Legacy Contact types for backward compatibility
public typealias Contact = Person
public typealias ContactCreate = PersonCreate

public struct PipelineDef: Codable { public let name: String; public let nodes: [NodeDef]; public let edges: [[String]]
    public init(name: String, nodes: [NodeDef], edges: [[String]]) { self.name = name; self.nodes = nodes; self.edges = edges }
}
public struct NodeDef: Codable { public let id: String; public let type: String; public let config: [String: CodableValue]?
    public init(id: String, type: String, config: [String: CodableValue]? = nil) { self.id = id; self.type = type; self.config = config }
}

public struct PipelineRun: Codable { public let runId: String; public let status: String }
public struct PipelineRunStatus: Codable { public let id: String; public let status: String; public let log: [String] }

public enum CodableValue: Codable {
    case string(String), number(Double), bool(Bool), obj([String: CodableValue]), arr([CodableValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([CodableValue].self) { self = .arr(a); return }
        if let o = try? c.decode([String: CodableValue].self) { self = .obj(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .arr(let a): try c.encode(a)
        case .obj(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }
}

public final class SSEStream: NSObject, URLSessionDataDelegate {
    public typealias Handler = (String, Data?) -> Void
    private var onEvent: Handler?
    private var buffer = Data()

    public func start(url: URL, onEvent: @escaping Handler) {
        self.onEvent = onEvent
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        session.dataTask(with: url).resume()
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer.append(data)
        while let range = buffer.range(of: Data([0x0a, 0x0a])) { // "\n\n"
            let chunk = buffer.subdata(in: 0..<range.lowerBound)
            buffer.removeSubrange(0..<range.upperBound)
            if let line = String(data: chunk, encoding: .utf8) {
                var event = "message"
                var dataStr = ""
                for l in line.split(separator: "\n") {
                    if l.hasPrefix("event:") { event = l.dropFirst(6).trimmingCharacters(in: .whitespaces) }
                    if l.hasPrefix("data:") { dataStr += l.dropFirst(5).trimmingCharacters(in: .whitespaces) }
                }
                onEvent?(event, dataStr.data(using: .utf8))
            }
        }
    }
}

